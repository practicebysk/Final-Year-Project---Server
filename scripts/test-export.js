const assert = require('node:assert/strict');
const JSZip = require('jszip');
const env = require('../src/config/env');
const { assertAllowedUrl, isPublicAddress } = require('../src/services/asset-downloader');
const { buildExport, ensureLinks } = require('../src/services/export.service');

const ok = (label) => console.log(`  ok  ${label}`);

(async () => {
  // ---- SSRF protection ----
  for (const a of ['127.0.0.1', '10.1.2.3', '192.168.1.5', '172.16.0.1', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicAddress(a), false, a);
  }
  for (const a of ['8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPublicAddress(a), true, a);
  ok('private, loopback and metadata addresses are blocked; public ones are allowed');

  for (const u of [
    'http://images.unsplash.com/a.jpg',
    'https://user:pass@images.unsplash.com/a.jpg',
    'https://images.unsplash.com:8443/a.jpg',
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://2130706433/a.png', // decimal form of 127.0.0.1
    'https://169.254.169.254/latest/meta-data/',
  ]) {
    assert.throws(() => assertAllowedUrl(new URL(u)), Error, u);
  }
  assert.doesNotThrow(() => assertAllowedUrl(new URL('https://images.unsplash.com/photo-1')));
  ok('unsafe URLs are rejected');

  // ---- Export with a fake downloader ----
  const html =
    '<!DOCTYPE html><html><head><title>t</title><link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"></head><body>' +
    '<img src="https://images.unsplash.com/photo-1?auto=format&amp;fit=crop&amp;w=800" alt="a">' +
    '<div style="background:url(\'https://images.unsplash.com/photo-2\')"></div>' +
    '<img src="https://bad.example/x.jpg" alt="b"></body></html>';
  const css = '.hero{background:url("https://images.unsplash.com/photo-1?auto=format&fit=crop&w=800")}';
  const downloader = async (url) => {
    if (url.includes('bad.example')) throw new Error('HTTP 404');
    return { data: Buffer.from(`IMG:${url}`), ext: 'jpg' };
  };

  const result = await buildExport({ projectName: 'Royal Salon', html, css, javascript: 'console.log(1);', downloader });
  assert.equal(result.included, 2);
  assert.equal(result.skipped, 1);

  const zip = await JSZip.loadAsync(result.buffer);
  const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
  assert.deepEqual(names, ['README.txt', 'assets/image-1.jpg', 'assets/image-2.jpg', 'index.html', 'script.js', 'style.css']);
  ok('ZIP contains only the expected files');

  const outHtml = await zip.file('index.html').async('string');
  const outCss = await zip.file('style.css').async('string');
  assert.ok(!outHtml.includes('images.unsplash.com'), 'downloaded images point to local files');
  assert.ok(outHtml.includes('assets/image-1.jpg') && outHtml.includes('assets/image-2.jpg'));
  assert.ok(outHtml.includes('https://bad.example/x.jpg'), 'failed image keeps its online URL');
  assert.ok(outHtml.includes('fonts.googleapis.com'), 'fonts stay online');
  assert.ok(outCss.includes('assets/image-1.jpg') && !outCss.includes('unsplash'));
  ok('images localised, failures and fonts left online');

  assert.ok(/href="style\.css"/.test(outHtml) && /src="script\.js"/.test(outHtml));
  ok('stylesheet link and script tag were added to the HTML');

  const noImages = await buildExport({ projectName: 'x', html: html, css, javascript: '', includeAssets: false });
  assert.equal(noImages.included, 0);
  assert.ok((await (await JSZip.loadAsync(noImages.buffer)).file('index.html').async('string')).includes('images.unsplash.com'));
  ok('includeAssets=false keeps online URLs');

  assert.equal((ensureLinks('<html><head></head><body></body></html>').match(/style\.css/g) ?? []).length, 1);
  const already = '<html><head><link rel="stylesheet" href="./style.css"></head><body><script src="script.js"></script></body></html>';
  assert.equal(ensureLinks(already), already);
  ok('ensureLinks adds missing tags and never duplicates them');

  // ---- Secrets ----
  const leak = (text) => buildExport({ projectName: 'x', html: `<html><body>${text}</body></html>`, css: '', javascript: '', downloader });
  await assert.rejects(() => leak(env.jwtSecret), /server secret/);
  await assert.rejects(() => leak('mongodb://user:pw@host/db'), /server secret/);
  await assert.rejects(() => leak(`AIza${'A'.repeat(35)}`), /server secret/);
  ok('server secrets and credentials block the export');

  console.log('\nAll export tests passed');
})().catch((err) => {
  console.error(err);
  process.exit(1);
}); 