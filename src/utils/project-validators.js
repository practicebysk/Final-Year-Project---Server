const AppError = require('./AppError');

const FIELDS = [
  { key: 'projectName', label: 'Project name', max: 60, required: true, trim: true },
  { key: 'businessName', label: 'Business name', max: 100, required: true, trim: true },
  { key: 'businessType', label: 'Business type', max: 40, trim: true },
  { key: 'prompt', label: 'Prompt', max: 5000, trim: true },
  { key: 'html', label: 'HTML', max: 300000 },
  { key: 'css', label: 'CSS', max: 300000 },
  { key: 'javascript', label: 'JavaScript', max: 300000 },
];
const MAX_ASSETS = 50;
const HTTP_URL = /^https?:\/\//i;

/**
 * Whitelist validator. Returns a NEW object containing only known, valid fields,
 * so userId / _id / createdAt in the request body can never reach the database.
 * partial = true is used for PUT: every field is optional, but at least one is needed.
 */
const validateProjectInput = (body, { partial = false } = {}) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppError('Request body must be a JSON object', 400);
  }

  const data = {};
  const errors = [];

  for (const f of FIELDS) {
    const raw = body[f.key];

    if (raw === undefined) {
      if (f.required && !partial) errors.push({ field: f.key, message: `${f.label} is required` });
      continue;
    }
    if (typeof raw !== 'string') {
      errors.push({ field: f.key, message: `${f.label} must be text` });
      continue;
    }

    const value = f.trim ? raw.trim() : raw;
    if (f.required && !value) errors.push({ field: f.key, message: `${f.label} is required` });
    else if (value.length > f.max) errors.push({ field: f.key, message: `${f.label} must be at most ${f.max} characters` });
    else data[f.key] = value;
  }

  if (body.assets !== undefined) {
    if (!Array.isArray(body.assets) || body.assets.length > MAX_ASSETS) {
      errors.push({ field: 'assets', message: `Assets must be a list of at most ${MAX_ASSETS} items` });
    } else {
      const assets = [];
      let valid = true;
      for (const item of body.assets) {
        const name = typeof item?.name === 'string' ? item.name.trim() : '';
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        if (!name || name.length > 100 || !url || url.length > 2000 || !HTTP_URL.test(url)) {
          valid = false;
          break;
        }
        assets.push({ name, url });
      }
      if (valid) data.assets = assets;
      else errors.push({ field: 'assets', message: 'Each asset needs a name (max 100 characters) and an http(s) URL (max 2000 characters)' });
    }
  }

  if (errors.length) throw new AppError(errors[0].message, 400, errors);
  if (partial && Object.keys(data).length === 0) throw new AppError('No valid fields to update', 400);

  return data;
};

module.exports = { validateProjectInput };