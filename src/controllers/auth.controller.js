const authService = require('../services/auth.service');
const asyncHandler = require('../utils/asyncHandler');
const { validateRegister, validateLogin } = require('../utils/validators');

const register = asyncHandler(async (req, res) => {
  const input = validateRegister(req.body);
  const { user, token } = await authService.register(input);
  res.status(201).json({ success: true, token, user });
});

const login = asyncHandler(async (req, res) => {
  const input = validateLogin(req.body);
  const { user, token } = await authService.login(input);
  res.json({ success: true, token, user });
});

const me = (req, res) => {
  res.json({ success: true, user: req.user });
};

module.exports = { register, login, me };