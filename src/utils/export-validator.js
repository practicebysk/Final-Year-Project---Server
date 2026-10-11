const AppError = require('./AppError');

const MAX_CODE = 300000; // same limit as the Project model

const validateExportInput = (body) => {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};

  const code = {};
  for (const [key, label] of [['html', 'HTML'], ['css', 'CSS'], ['javascript', 'JavaScript']]) {
    if (typeof b[key] !== 'string') throw new AppError(`${label} must be text`, 400);
    if (b[key].length > MAX_CODE) throw new AppError(`${label} is too large`, 400);
    code[key] = b[key];
  }
  if (!code.html.trim()) throw new AppError('The website has no HTML to export', 400);

  return { ...code, includeAssets: b.includeAssets !== false };
};

module.exports = { validateExportInput };