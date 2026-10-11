const geminiService = require('../services/gemini.service');
const projectService = require('../services/project.service');
const versionService = require('../services/version.service');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');
const { validateGenerateInput, validateModifyInput } = require('../utils/website-validator');

const generate = asyncHandler(async (req, res) => {
  const { prompt } = validateGenerateInput(req.body);
  const result = await geminiService.generateWebsite(prompt);
  res.json({ success: true, ...result });
});

const modify = asyncHandler(async (req, res) => {
  const input = validateModifyInput(req.body);

  const projectId = req.body.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new AppError('projectId is required', 400);
  await projectService.getById(req.user._id, projectId); // 404 for someone else's project, before any AI call

  const result = await geminiService.modifyWebsite(input);

  // Saves the result as a new version and makes it the project's code.
  const version = await versionService.applyAiResult(req.user._id, projectId, {
    before: { html: input.html, css: input.css, javascript: input.js },
    after: {
      html: result.files['index.html'],
      css: result.files['style.css'],
      javascript: result.files['script.js'],
    },
    summary: result.summary,
  });

  res.json({ success: true, ...result, version });
});

module.exports = { generate, modify };