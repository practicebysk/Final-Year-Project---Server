const Project = require('../models/project.model');
const AppError = require('../utils/AppError');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const SUMMARY_FIELDS = 'projectName businessName businessType createdAt updatedAt';

const notFound = () => new AppError('Project not found', 404);

// Every function below filters by userId. That filter is the ownership rule:
// a project that belongs to someone else is indistinguishable from one that doesn't exist.
const ownedBy = (userId, id) => {
  if (!OBJECT_ID.test(String(id))) throw notFound();
  return { _id: id, userId };
};

const list = (userId) =>
  Project.find({ userId }).select(SUMMARY_FIELDS).sort({ updatedAt: -1 }).limit(200);

const create = async (userId, data) => {
  const project = await Project.create({ ...data, userId });
  await ensureInitialVersion(project);
  return project;
};;

const getById = async (userId, id) => {
  const project = await Project.findOne(ownedBy(userId, id));
  if (!project) throw notFound();
  return project;
};

const update = async (userId, id, changes) => {
  const project = await Project.findOneAndUpdate(
    ownedBy(userId, id),
    { $set: changes },
    { returnDocument: 'after', runValidators: true },
  );
  if (!project) throw notFound();
  return project;
};

const remove = async (userId, id) => {
  const project = await Project.findOneAndDelete(ownedBy(userId, id));
  if (!project) throw notFound();
  await versionService.removeAll(project._id).catch((err) => console.error('Could not delete versions:', err.message));
};

const COPY_SUFFIX = ' (Copy)';

// Copies one of the user's own projects. The ownership filter is the same as every other query.
const duplicate = async (userId, id) => {
  const source = await Project.findOne(ownedBy(userId, id));
  if (!source) throw notFound();

  return Project.create({
    userId,
    projectName: `${source.projectName.slice(0, 60 - COPY_SUFFIX.length)}${COPY_SUFFIX}`,
    businessName: source.businessName,
    businessType: source.businessType,
    prompt: source.prompt,
    html: source.html,
    css: source.css,
    javascript: source.javascript,
    assets: source.assets.map((a) => ({ name: a.name, url: a.url })),
  });
};

const versionService = require('./version.service.js');

// A missing Version 1 is created later when the history is opened, so this never blocks the request.
const ensureInitialVersion = (project) =>
  versionService.ensureInitial(project).catch((err) => console.error('Could not create the initial version:', err.message));

const MAX_PROJECTS = 50;
const assertUnderLimit = async (userId) => {
  if ((await Project.countDocuments({ userId })) >= MAX_PROJECTS) {
    throw new AppError(`Project limit reached (${MAX_PROJECTS}). Delete a project first.`, 409);
  }
};

module.exports = { list, create, getById, update, remove, duplicate };
