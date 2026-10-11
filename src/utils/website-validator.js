const AppError = require('./AppError');

// Thrown when Gemini's output is unusable. The service may retry once on this error.
class OutputError extends Error {}

const FILE_NAMES = ['index.html', 'style.css', 'script.js'];
const BUSINESS_TYPES = ['Salon', 'Restaurant', 'Gym', 'Clinic', 'Shop', 'Portfolio', 'Other'];
const MAX_CODE = 300000; // same limit as the Project model
const MAX_ASSETS = 50;

const PLACEHOLDER_HOSTS =
  /(via\.placeholder\.com|placeholder\.com|placehold\.co|placehold\.it|dummyimage\.com|lorempixel\.com|fakeimg\.pl|placekitten\.com|placebear\.com)/i;

const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{35}/, // Google API key
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9_-]{20,}/, // common secret-key prefix
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{36}\b/, // GitHub token
  /mongodb(?:\+srv)?:\/\//i,
  /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{8,}['"]/i,
];

const fail = (message) => {
  throw new OutputError(message);
};

// ---------- Input (what Angular sends) ----------

const validateGenerateInput = (body) => {
  const prompt = typeof body?.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) throw new AppError('Prompt is required', 400);
  if (prompt.length < 10) throw new AppError('Prompt must be at least 10 characters', 400);
  if (prompt.length > 5000) throw new AppError('Prompt must be at most 5000 characters', 400);
  return { prompt };
};

// ---------- Output (what Gemini returns) ----------

const checkHtml = (html) => {
  if (!/<!doctype html/i.test(html) || !/<html[\s>]/i.test(html) || !/<body[\s>]/i.test(html)) {
    fail('index.html must be a complete HTML5 document');
  }
  if (/\b(?:href|src|action)\s*=\s*["']?\s*javascript:/i.test(html)) {
    fail('javascript: URLs are not allowed');
  }
  for (const m of html.matchAll(/<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi)) {
    if (!/^(?:\.\/)?script\.js$/i.test(m[1])) fail(`External script not allowed: ${m[1]}`);
  }
};

const checkSecrets = (text, secrets) => {
  if (SECRET_PATTERNS.some((re) => re.test(text))) fail('The output contains something that looks like a secret or credential');
  for (const s of secrets) {
    if (s && s.length >= 8 && text.includes(s)) fail('The output contains a server secret');
  }
};

// Returns every <img> as { src, alt } after checking it is a real https URL.
const checkImages = (html) => {
  const images = [];
  for (const [tag] of html.matchAll(/<img\b[^>]*>/gi)) {
    const src = (tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i) || [])[1];
    const alt = (tag.match(/\balt\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
    if (!src) fail('An <img> tag has no src');
    if (/^data:image\//i.test(src)) continue;
    if (!/^https:\/\//i.test(src)) fail(`Image URL must be a full https URL: ${src.slice(0, 80)}`);
    images.push({ src, alt });
  }
  return images;
};

const checkCssUrls = (text) => {
  for (const m of text.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
    const url = m[2].trim();
    if (!/^(?:https:\/\/|data:|#)/i.test(url)) fail(`CSS url() must be https or data: ${url.slice(0, 80)}`);
  }
};

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

const validateGeneratedWebsite = (data, { secrets = [] } = {}) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('The top-level value must be a JSON object');
  if (!data.files || typeof data.files !== 'object') fail('"files" is missing');

  const files = {};
  for (const name of FILE_NAMES) {
    const content = data.files[name];
    if (typeof content !== 'string' || !content.trim()) fail(`files["${name}"] is missing or empty`);
    if (content.length > MAX_CODE) fail(`files["${name}"] is too large`);
    files[name] = content;
  }
  const html = files['index.html'];
  const css = files['style.css'];
  const js = files['script.js'];
  const everything = `${html}\n${css}\n${js}`;

  checkHtml(html);
  if (PLACEHOLDER_HOSTS.test(everything)) fail('Placeholder image services are not allowed');
  checkSecrets(everything, secrets);
  const images = checkImages(html);
  checkCssUrls(css);
  checkCssUrls(html);

  // Metadata is repaired, not rejected.
  const p = data.project && typeof data.project === 'object' ? data.project : {};
  const businessName = cleanText(p.businessName, 100) || 'My Business';
  const projectName = cleanText(p.projectName, 60) || businessName.slice(0, 60);
  const type = cleanText(p.businessType, 40).toLowerCase();
  const businessType = BUSINESS_TYPES.find((t) => t.toLowerCase() === type) ?? 'Other';

  // Assets: Gemini's list plus every image actually used, valid https only, de-duplicated.
  const assets = [];
  const seen = new Set();
  const addAsset = (name, url) => {
    const u = typeof url === 'string' ? url.trim() : '';
    if (assets.length >= MAX_ASSETS || seen.has(u) || u.length > 2000 || !/^https:\/\//i.test(u)) return;
    seen.add(u);
    assets.push({ name: cleanText(name, 100) || `Image ${assets.length + 1}`, url: u });
  };
  if (Array.isArray(data.assets)) data.assets.forEach((a) => addAsset(a?.name, a?.url));
  images.forEach((img) => addAsset(img.alt, img.src));

  return { project: { projectName, businessName, businessType }, files, assets };
};

// ---------- Modify: input (what Angular sends) ----------

const validateModifyInput = (body) => {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const userRequest = typeof b.userRequest === 'string' ? b.userRequest.trim() : '';
  if (userRequest.length < 3) throw new AppError('Describe the change you want (at least 3 characters)', 400);
  if (userRequest.length > 1000) throw new AppError('The request must be at most 1000 characters', 400);

  const code = {};
  for (const [key, label] of [['existingHtml', 'HTML'], ['existingCss', 'CSS'], ['existingJavaScript', 'JavaScript']]) {
    if (typeof b[key] !== 'string') throw new AppError(`${label} must be text`, 400);
    if (b[key].length > MAX_CODE) throw new AppError(`${label} is too large`, 400);
    code[key] = b[key];
  }
  if (!code.existingHtml.trim()) throw new AppError('The website has no HTML to modify', 400);

  return { userRequest, html: code.existingHtml, css: code.existingCss, js: code.existingJavaScript };
};

// ---------- Modify: output (what Gemini returns) ----------

const validateModifiedWebsite = (data, { secrets = [], original }) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('The top-level value must be a JSON object');

  // Reuses every generation check: HTML5 document, scripts, URLs, images, secrets, size.
  const site = validateGeneratedWebsite(
    {
      files: { 'index.html': data.updatedHtml, 'style.css': data.updatedCss, 'script.js': data.updatedJavaScript },
      assets: data.assets,
    },
    { secrets },
  );

  const before = { 'index.html': original.html, 'style.css': original.css, 'script.js': original.js };
  for (const name of FILE_NAMES) {
    if (before[name].length > 1500 && site.files[name].length < before[name].length * 0.4) {
      fail(`${name} became much smaller than the original. Keep all existing content and only apply the requested change`);
    }
  }
  if (FILE_NAMES.every((name) => site.files[name] === before[name])) {
    fail('No changes were made. Apply the requested change to the code');
  }

  return {
    files: site.files,
    assets: site.assets,
    summary: cleanText(data.summary, 300) || 'The website was updated.',
  };
};

module.exports = {
  OutputError,
  validateGenerateInput,
  validateGeneratedWebsite,
  validateModifyInput,
  validateModifiedWebsite,
};