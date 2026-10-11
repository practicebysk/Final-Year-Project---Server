const JSZip = require('jszip');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { downloadImage } = require('./asset-downloader');

const MAX_IMAGES = 30;
const MAX_TOTAL_BYTES = 30 * 1024 * 1024;
const CONCURRENCY = 4;
const FONT_HOSTS = /^(?:fonts\.googleapis\.com|fonts\.gstatic\.com)$/i; // fonts stay online (see README)

const decodeAmp = (s) => s.replace(/&amp;/gi, '&');
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const slugify = (name) =>
  String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'website';

// The export must never contain anything that belongs to the server.
const assertNoServerSecrets = (text) => {
  const secrets = [env.geminiApiKey, env.jwtSecret, env.mongoUri].filter((s) => s && s.length >= 8);
  if (
    secrets.some((s) => text.includes(s)) ||
    /mongodb(?:\+srv)?:\/\//i.test(text) ||
    /AIza[0-9A-Za-z_-]{35}/.test(text)
  ) {
    throw new AppError('Export blocked: the code contains something that looks like a server secret or database credential. Remove it and try again.', 422);
  }
};

const injectBefore = (doc, closingTag, content) => {
  const index = doc.toLowerCase().lastIndexOf(closingTag);
  return index === -1 ? doc + content : doc.slice(0, index) + content + doc.slice(index);
};

// The live preview injects these at runtime. The exported file must contain them itself.
const ensureLinks = (html) => {
  let doc = html;
  if (!/<link\b[^>]*href\s*=\s*["']\.?\/?style\.css["'][^>]*>/i.test(doc)) {
    doc = injectBefore(doc, '</head>', '  <link rel="stylesheet" href="style.css">\n');
  }
  if (!/<script\b[^>]*src\s*=\s*["']\.?\/?script\.js["'][^>]*>/i.test(doc)) {
    doc = injectBefore(doc, '</body>', '  <script src="script.js"></script>\n');
  }
  return doc;
};

// Raw https image URLs exactly as written in the code: <img src>, and url(...) in CSS or inline styles.
const findImageUrls = (html, css) => {
  const found = new Set();
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const m = tag.match(/\bsrc\s*=\s*(["'])(https:\/\/.*?)\1/i);
    if (m) found.add(m[2]);
  }
  for (const text of [html, css]) {
    for (const m of text.matchAll(/url\(\s*(["']?)(https:\/\/[^"')\s]+)\1\s*\)/gi)) found.add(m[2]);
  }
  return [...found];
};

const usable = (raw) => {
  try {
    return !FONT_HOSTS.test(new URL(decodeAmp(raw)).hostname);
  } catch {
    return false;
  }
};

const replaceUrl = (text, raw, localPath) =>
  text.replace(new RegExp(`${escapeRegExp(raw)}(?=["'()\\s>])`, 'g'), () => localPath);

// Downloads images and points the code at assets/image-N.ext. Images that fail keep their online URL.
const localizeAssets = async (html, css, downloader) => {
  const byUrl = new Map(); // downloadable URL -> every raw spelling of it (&amp; and & are different text)
  for (const raw of findImageUrls(html, css).filter(usable)) {
    const url = decodeAmp(raw);
    byUrl.set(url, [...(byUrl.get(url) ?? []), raw]);
  }

  const urls = [...byUrl.keys()];
  const candidates = urls.slice(0, MAX_IMAGES);
  let skipped = urls.length - candidates.length;

  const files = [];
  const replacements = [];
  let total = 0;

  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((url) => downloader(url)));

    results.forEach((result, index) => {
      if (result.status !== 'fulfilled') {
        skipped += 1;
        console.warn(`Export: image kept online (${result.reason?.message ?? 'failed'}): ${batch[index].slice(0, 120)}`);
        return;
      }
      const { data, ext } = result.value;
      if (total + data.length > MAX_TOTAL_BYTES) {
        skipped += 1;
        return;
      }
      total += data.length;
      const path = `assets/image-${files.length + 1}.${ext}`;
      files.push({ path, data });
      byUrl.get(batch[index]).forEach((raw) => replacements.push({ raw, path }));
    });
  }

  let outHtml = html;
  let outCss = css;
  for (const { raw, path } of replacements) {
    outHtml = replaceUrl(outHtml, raw, path);
    outCss = replaceUrl(outCss, raw, path);
  }
  return { html: outHtml, css: outCss, files, skipped };
};

const readme = (projectName, hasAssets) =>
  [
    String(projectName).slice(0, 100),
    'Exported from AI Website Builder',
    '',
    'HOW TO USE',
    '1. Extract this ZIP.',
    '2. Open index.html in a web browser. No server, installation or build step is needed.',
    '',
    'FILES',
    'index.html  - page structure',
    'style.css   - styles',
    'script.js   - behaviour',
    ...(hasAssets ? ['assets/     - images saved from the online website'] : []),
    '',
    'NOTES',
    '- Google Fonts, if the site uses them, load from the internet. Offline, the browser uses a fallback font.',
    '- Any image that could not be saved stays an online link and needs an internet connection.',
    '- To publish the site, upload all files (keeping the same folder layout) to any static web host.',
    '',
  ].join('\r\n');

/**
 * Builds the ZIP. `downloader` can be replaced in tests.
 * Returns { buffer, included, skipped }.
 */
const buildExport = async ({ projectName, html, css, javascript, includeAssets = true, downloader = downloadImage }) => {
  assertNoServerSecrets(`${html}\n${css}\n${javascript}`);

  let outHtml = html;
  let outCss = css;
  let assetFiles = [];
  let skipped = 0;
  if (includeAssets) {
    ({ html: outHtml, css: outCss, files: assetFiles, skipped } = await localizeAssets(html, css, downloader));
  }
  outHtml = ensureLinks(outHtml);

  const zip = new JSZip();
  zip.file('index.html', outHtml);
  zip.file('style.css', outCss);
  zip.file('script.js', javascript);
  assetFiles.forEach((file) => zip.file(file.path, file.data));
  zip.file('README.txt', readme(projectName, assetFiles.length > 0));

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { buffer, included: assetFiles.length, skipped };
};

module.exports = { buildExport, ensureLinks, findImageUrls, slugify };