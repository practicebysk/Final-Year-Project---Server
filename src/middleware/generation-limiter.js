const AppError = require('../utils/AppError');

const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 30;// per user per window
const hits = new Map(); // userId -> timestamps of recent requests
const inFlight = new Set(); // userIds with a generation currently running

// In-memory: resets on restart and is per-process. Fine for one server; use Redis if you scale out.
setInterval(() => {
  const now = Date.now();
  for (const [key, times] of hits) {
    const recent = times.filter((t) => now - t < WINDOW_MS);
    if (recent.length) hits.set(key, recent);
    else hits.delete(key);
  }
}, WINDOW_MS).unref();

// Must run after `protect`, because it needs req.user.
const generationLimiter = (req, res, next) => {
  const key = String(req.user._id);
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (inFlight.has(key)) {
    return next(new AppError('A website is already being generated. Please wait for it to finish.', 429));
  }
  if (recent.length >= MAX_REQUESTS) {
    const retryAfter = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
    res.set('Retry-After', String(retryAfter));
    return next(new AppError(`Generation limit reached. Try again in about ${Math.ceil(retryAfter / 60)} minute(s).`, 429));
  }

  recent.push(now);
  hits.set(key, recent);
  inFlight.add(key);
  res.once('close', () => inFlight.delete(key)); // fires on success, error, and client disconnect

  next();
};

module.exports = { generationLimiter };