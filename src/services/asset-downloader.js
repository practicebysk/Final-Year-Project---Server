const dns = require('node:dns');
const https = require('node:https');
const net = require('node:net');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 10000; // per request, including DNS and download
const MAX_REDIRECTS = 3;

// SVG is excluded on purpose: it can contain scripts and would run if opened directly from the extracted folder.
const IMAGE_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

// Addresses a server must never be tricked into contacting (private networks, loopback, cloud metadata, ...).
const blocked = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv4'));
[
  ['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64],
  ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
].forEach(([address, prefix]) => blocked.addSubnet(address, prefix, 'ipv6'));

const isPublicAddress = (address) => {
  const family = net.isIP(address);
  if (!family) return false;
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
};

// Used by the HTTPS request instead of the default DNS lookup, so the address that is
// validated is the address that is connected to (no DNS-rebinding gap).
const safeLookup = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || !addresses.every((a) => isPublicAddress(a.address))) {
      return callback(new Error('Address is not public'));
    }
    if (options && options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

const assertAllowedUrl = (url) => {
  if (url.protocol !== 'https:') throw new Error('Only https URLs are allowed');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed');
  if (url.port && url.port !== '443') throw new Error('Only the default https port is allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  // IP literals skip DNS, so they must be checked here.
  if (net.isIP(host) && !isPublicAddress(host)) throw new Error('Address is not public');
};

const requestOnce = (url) =>
  new Promise((resolve, reject) => {
    assertAllowedUrl(url); // a throw here rejects the promise

    let timer;
    const req = https.get(
      url,
      {
        lookup: safeLookup,
        agent: false,
        headers: { 'User-Agent': 'AIWebsiteBuilder-Export/1.0', Accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif' },
      },
      (res) => {
        const status = res.statusCode ?? 0;

        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          clearTimeout(timer);
          return resolve({ redirect: res.headers.location });
        }
        if (status !== 200) {
          res.resume();
          clearTimeout(timer);
          return reject(new Error(`HTTP ${status}`));
        }

        const type = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const ext = IMAGE_TYPES[type];
        if (!ext) {
          res.resume();
          clearTimeout(timer);
          return reject(new Error('Not a supported image type'));
        }
        if (Number(res.headers['content-length']) > MAX_IMAGE_BYTES) {
          req.destroy();
          clearTimeout(timer);
          return reject(new Error('Image is too large'));
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_IMAGE_BYTES) {
            req.destroy();
            clearTimeout(timer);
            reject(new Error('Image is too large'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({ data: Buffer.concat(chunks), ext });
        });
        res.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      },
    );

    timer = setTimeout(() => req.destroy(new Error('Timed out')), TIMEOUT_MS);
    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

/** Downloads one image. Resolves { data: Buffer, ext } or throws. */
const downloadImage = async (urlString) => {
  let url = new URL(urlString);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await requestOnce(url);
    if (result.redirect) {
      url = new URL(result.redirect, url); // the next hop is validated again inside requestOnce
      continue;
    }
    return { data: result.data, ext: result.ext };
  }
  throw new Error('Too many redirects');
};

module.exports = { downloadImage, isPublicAddress, assertAllowedUrl };