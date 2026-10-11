const assert = require('node:assert/strict');
const { OutputError, validateGeneratedWebsite } = require('../src/utils/website-validator');
const { parseModelJson } = require('../src/services/gemini.service');

const good = () => ({
  project: { projectName: 'Royal Salon', businessName: 'Royal Beauty Salon', businessType: 'salon' },
  files: {
    'index.html':
      '<!DOCTYPE html><html lang="en"><head><link rel="stylesheet" href="style.css"></head><body>' +
      '<img src="https://images.unsplash.com/photo-1?w=800" alt="Salon interior">' +
      '<script src="script.js"></script></body></html>',
    'style.css': 'body{margin:0}',
    'script.js': 'console.log(1);',
  },
  assets: [],
});

const rejects = (label, mutate) => {
  const data = good();
  mutate(data);
  assert.throws(() => validateGeneratedWebsite(data), OutputError, label);
  console.log(`  ok  rejects: ${label}`);
};

// Valid output passes and is normalised
const ok = validateGeneratedWebsite(good());
assert.equal(ok.project.businessType, 'Salon');
assert.equal(ok.assets.length, 1);
assert.equal(ok.assets[0].name, 'Salon interior');
console.log('  ok  accepts valid website');

rejects('missing css', (d) => delete d.files['style.css']);
rejects('blank javascript', (d) => (d.files['script.js'] = '   '));
rejects('not an HTML document', (d) => (d.files['index.html'] = 'hello'));
rejects('placeholder image host', (d) => (d.files['index.html'] = d.files['index.html'].replace('https://images.unsplash.com/photo-1?w=800', 'https://via.placeholder.com/600')));
rejects('relative image path', (d) => (d.files['index.html'] = d.files['index.html'].replace('https://images.unsplash.com/photo-1?w=800', 'images/a.jpg')));
rejects('external script', (d) => (d.files['index.html'] = d.files['index.html'].replace('</body>', '<script src="https://evil.example/x.js"></script></body>')));
rejects('javascript: url', (d) => (d.files['index.html'] = d.files['index.html'].replace('</body>', '<a href="javascript:alert(1)">x</a></body>')));
rejects('google api key in code', (d) => (d.files['script.js'] = `const k='AIza${'A'.repeat(35)}';`));
rejects('relative css url', (d) => (d.files['style.css'] = 'body{background:url(img/bg.jpg)}'));
assert.throws(() => validateGeneratedWebsite(null), OutputError);
assert.throws(() => validateGeneratedWebsite([]), OutputError);
console.log('  ok  rejects: null and array');

// JSON parsing
assert.deepEqual(parseModelJson('```json\n{"a":1}\n```'), { a: 1 });
assert.throws(() => parseModelJson('not json'), OutputError);
assert.throws(() => parseModelJson(''), OutputError);
console.log('  ok  parses fenced JSON, rejects invalid and empty');

console.log('\nAll validator tests passed');