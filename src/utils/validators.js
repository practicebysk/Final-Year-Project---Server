const AppError = require('./AppError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD_BYTES = 72; // bcrypt ignores anything beyond 72 bytes

// Anything that is not a string becomes '' (blocks NoSQL operator objects like { $gt: '' }).
const text = (value) => (typeof value === 'string' ? value.trim() : '');

const fail = (errors) => {
  throw new AppError(errors[0].message, 400, errors);
};

const validateRegister = (body = {}) => {
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = [];

  if (!name) errors.push({ field: 'name', message: 'Name is required' });
  else if (name.length > 60) errors.push({ field: 'name', message: 'Name must be at most 60 characters' });

  if (!email) errors.push({ field: 'email', message: 'Email is required' });
  else if (!EMAIL_RE.test(email) || email.length > 254) errors.push({ field: 'email', message: 'Enter a valid email address' });

  if (!password) errors.push({ field: 'password', message: 'Password is required' });
  else if (password.length < 8) errors.push({ field: 'password', message: 'Password must be at least 8 characters' });
  else if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) errors.push({ field: 'password', message: 'Password is too long (max 72 bytes)' });

  if (errors.length) fail(errors);
  return { name, email, password };
};

const validateLogin = (body = {}) => {
  const email = text(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const errors = [];

  if (!email) errors.push({ field: 'email', message: 'Email is required' });
  if (!password) errors.push({ field: 'password', message: 'Password is required' });

  if (errors.length) fail(errors);
  return { email, password };
};

module.exports = { validateRegister, validateLogin };