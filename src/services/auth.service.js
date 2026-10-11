const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/user.model');
const AppError = require('../utils/AppError');

// Compared against when the email doesn't exist, so response time doesn't reveal registered emails.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', env.bcryptRounds);

const signToken = (userId) =>
  jwt.sign({ sub: String(userId) }, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: env.jwtExpiresIn,
  });

const register = async ({ name, email, password }) => {
  if (await User.exists({ email })) {
    throw new AppError('Email already registered', 409);
  }
  const hashed = await bcrypt.hash(password, env.bcryptRounds);
  const user = await User.create({ name, email, password: hashed });
  return { user, token: signToken(user._id) };
};

const login = async ({ email, password }) => {
  const user = await User.findOne({ email }).select('+password');
  const matches = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

  if (!user || !matches) {
    throw new AppError('Invalid email or password', 401);
  }
  return { user, token: signToken(user._id) };
};

module.exports = { register, login };