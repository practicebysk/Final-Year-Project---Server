const Project = require('../models/project.model');
const WebsiteVersion = require('../models/website-version.model');
const AppError = require('../utils/AppError');

const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_VERSIONS = 100; // per project; the oldest are pruned, never version 1

const projectNotFound = () => new AppError('Project not found', 404);
const versionNotFound = () => new AppError('Version not found', 404);

const summarize = (v) => ({
  id: String(v._id),
  versionNumber: v.versionNumber,
  label: v.label,
  source: v.source,
  createdAt: v.createdAt,
});
const codeOf = (doc) => ({ html: doc.html, css: doc.css, javascript: doc.javascript });
const sameCode = (a, b) => a.html === b.html && a.css === b.css && a.javascript === b.javascript;

// Ownership rule: the project must belong to this user, otherwise it "does not exist".
const getOwnedProject = async (userId, id) => {
  if (!OBJECT_ID.test(String(id))) throw projectNotFound();
  const project = await Project.findOne({ _id: id, userId });
  if (!project) throw projectNotFound();
  return project;
};

const latestOf = (projectId) => WebsiteVersion.findOne({ projectId }).sort({ versionNumber: -1 });

// Removes the oldest versions beyond the cap. Version 1 is always kept.
const prune = async (projectId) => {
  const extra = (await WebsiteVersion.countDocuments({ projectId })) - MAX_VERSIONS;
  if (extra <= 0) return;
  const old = await WebsiteVersion.find({ projectId }).sort({ versionNumber: 1 }).skip(1).limit(extra).select('_id');
  await WebsiteVersion.deleteMany({ _id: { $in: old.map((v) => v._id) } });
};

// Appends a version. If a parallel request took the same number, the unique index rejects it and we retry.
const create = async (project, { label, source, code }) => {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const last = await WebsiteVersion.findOne({ projectId: project._id }).sort({ versionNumber: -1 }).select('versionNumber');
    try {
      const version = await WebsiteVersion.create({
        projectId: project._id,
        userId: project.userId,
        versionNumber: (last?.versionNumber ?? 0) + 1,
        label: label.slice(0, 200),
        source,
        ...code,
      });
      await prune(project._id).catch((err) => console.error('Version pruning failed:', err.message));
      return version;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  throw new AppError('Could not save the version. Please try again.', 409);
};

// Version 1. Safe to call many times: it only does something when the project has no versions yet.
const ensureInitial = async (project) => {
  if (await WebsiteVersion.exists({ projectId: project._id })) return;
  try {
    await WebsiteVersion.create({
      projectId: project._id,
      userId: project.userId,
      versionNumber: 1,
      label: 'Initial website',
      source: 'initial',
      ...codeOf(project),
    });
  } catch (err) {
    if (err.code !== 11000) throw err; // a parallel request created it
  }
};

// Makes `code` the project's current code. If that fails, the version is removed again.
const applyToProject = async (project, version, code) => {
  try {
    const updated = await Project.findOneAndUpdate(
      { _id: project._id, userId: project.userId },
      { $set: code },
      { returnDocument: 'after', runValidators: true },
    );
    if (!updated) throw projectNotFound(); // deleted in the meantime
    return updated;
  } catch (err) {
    await WebsiteVersion.deleteOne({ _id: version._id }).catch(() => {});
    throw err;
  }
};

const list = async (userId, projectId) => {
  const project = await getOwnedProject(userId, projectId);
  await ensureInitial(project); // covers projects created before this feature existed
  const versions = await WebsiteVersion.find({ projectId: project._id })
    .select('versionNumber label source createdAt')
    .sort({ versionNumber: -1 })
    .limit(MAX_VERSIONS);
  return versions.map(summarize);
};

const getOne = async (userId, projectId, number) => {
  const project = await getOwnedProject(userId, projectId);
  const version = await WebsiteVersion.findOne({ projectId: project._id, versionNumber: number });
  if (!version) throw versionNotFound();
  return { ...summarize(version), ...codeOf(version) };
};

// Called after Gemini succeeded. before = the code the AI started from, after = the AI result.
const applyAiResult = async (userId, projectId, { before, after, summary }) => {
  const project = await getOwnedProject(userId, projectId);
  await ensureInitial(project);

  // Keep the exact state the AI started from restorable (for example manual edits).
  const latest = await latestOf(project._id);
  if (latest && !sameCode(latest, before)) {
    await create(project, { label: 'Edits made before the AI change', source: 'snapshot', code: before });
  }

  const version = await create(project, { label: summary, source: 'ai', code: after });
  await applyToProject(project, version, after);
  return summarize(version);
};

// Restoring never deletes anything: it appends a new latest version with the old code.
const restore = async (userId, projectId, number) => {
  const project = await getOwnedProject(userId, projectId);
  const target = await WebsiteVersion.findOne({ projectId: project._id, versionNumber: number });
  if (!target) throw versionNotFound();

  // Saved edits that are not in any version yet get their own version first, so nothing is lost.
  const latest = await latestOf(project._id);
  if (latest && !sameCode(latest, project)) {
    await create(project, { label: 'Saved edits before restoring', source: 'snapshot', code: codeOf(project) });
  }

  const version = await create(project, { label: `Restored version ${number}`, source: 'restore', code: codeOf(target) });
  const updated = await applyToProject(project, version, codeOf(target));
  return { version: summarize(version), project: { ...codeOf(updated), updatedAt: updated.updatedAt } };
};

const removeAll = (projectId) => WebsiteVersion.deleteMany({ projectId });

module.exports = { ensureInitial, list, getOne, applyAiResult, restore, removeAll };