const projectService = require('../services/project.service');
const asyncHandler = require('../utils/asyncHandler');
const { validateProjectInput } = require('../utils/project-validators');

const create = asyncHandler(async (req, res) => {
  const data = validateProjectInput(req.body);
  const project = await projectService.create(req.user._id, data);
  res.status(201).json({ success: true, project });
});

const list = asyncHandler(async (req, res) => {
  const projects = await projectService.list(req.user._id);
  res.json({ success: true, projects });
});

const getOne = asyncHandler(async (req, res) => {
  const project = await projectService.getById(req.user._id, req.params.id);
  res.json({ success: true, project });
});

const update = asyncHandler(async (req, res) => {
  const changes = validateProjectInput(req.body, { partial: true });
  const project = await projectService.update(req.user._id, req.params.id, changes);
  res.json({ success: true, project });
});

const remove = asyncHandler(async (req, res) => {
  await projectService.remove(req.user._id, req.params.id);
  res.json({ success: true, message: 'Project deleted' });
});

const duplicate = asyncHandler(async (req, res) => {
  const project = await projectService.duplicate(req.user._id, req.params.id);
  res.status(201).json({ success: true, project });
});

module.exports = { create, list, getOne, update, remove, duplicate };