const AppError = require('../utils/AppError');

const createRateLimiter = ({ windowMs, max, message, keyFn = (req) => req.ip || 'unknown' }) => {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, times] of hits) {
      const recent = times.filter((t) => now - t < windowMs);
      if (recent.length) hits.set(key, recent);
      else hits.delete(key);
    }
  }, windowMs).unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      const retryAfter = Math.ceil((recent[0] + windowMs - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return next(new AppError(`${message} Try again in about ${Math.ceil(retryAfter / 60)} minute(s).`, 429));
    }

    recent.push(now);
    hits.set(key, recent);
    next();
  };
};

const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many login attempts.' });
const registerLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 10, message: 'Too many sign-ups from this address.' });

module.exports = { createRateLimiter, loginLimiter, registerLimiter };