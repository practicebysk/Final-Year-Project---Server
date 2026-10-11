const versionService = require('../services/version.service');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

// Only plain positive integers: "abc", "0", "01" and "1e3" are all 404.
const parseNumber = (value) => {
  if (!/^[1-9]\d{0,5}$/.test(value)) throw new AppError('Version not found', 404);
  return Number(value);
};

const list = asyncHandler(async (req, res) => {
  const versions = await versionService.list(req.user._id, req.params.id);
  res.json({ success: true, versions });
});

const getOne = asyncHandler(async (req, res) => {
  const version = await versionService.getOne(req.user._id, req.params.id, parseNumber(req.params.number));
  res.json({ success: true, version });
});

const restore = asyncHandler(async (req, res) => {
  const result = await versionService.restore(req.user._id, req.params.id, parseNumber(req.params.number));
  res.json({ success: true, ...result });
});

module.exports = { list, getOne, restore };