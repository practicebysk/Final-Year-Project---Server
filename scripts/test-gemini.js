const env = require('../src/config/env');

const models = process.argv.length > 2
  ? process.argv.slice(2)
  : ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

(async () => {
  for (const m of models) {
    const t = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.geminiApiKey },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Reply with the word OK' }] }] }),
        signal: AbortSignal.timeout(30000),
      });
      console.log(m.padEnd(26), r.status, `${Date.now() - t}ms`);
    } catch (e) {
      console.log(m.padEnd(26), 'error', e.name);
    }
  }
})();