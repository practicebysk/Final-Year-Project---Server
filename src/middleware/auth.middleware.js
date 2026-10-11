const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Protects a route. On success, sets req.user (a Mongoose document).
// Later project routes must scope every query by owner: { _id, owner: req.user.id }.
const protect = asyncHandler(async (req, res, next) => {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError('Authentication required', 401);
  }

  let payload;
  try {
    payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] });
  } catch (err) {
    throw new AppError(
      err.name === 'TokenExpiredError' ? 'Session expired. Please log in again.' : 'Invalid token',
      401,
    );
  }

  const user = await User.findById(payload.sub);
  if (!user) throw new AppError('User no longer exists', 401);

  req.user = user;
  next();
});

module.exports = { protect };