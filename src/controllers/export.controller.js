const exportService = require('../services/export.service');
const projectService = require('../services/project.service');
const asyncHandler = require('../utils/asyncHandler');
const { validateExportInput } = require('../utils/export-validator');

const exportProject = asyncHandler(async (req, res) => {
  const input = validateExportInput(req.body);
  const project = await projectService.getById(req.user._id, req.params.id); // 404 for someone else's project

  const { buffer, included, skipped } = await exportService.buildExport({ projectName: project.projectName, ...input });

  res.set({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${exportService.slugify(project.projectName)}.zip"`,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Assets-Included': String(included),
    'X-Assets-Skipped': String(skipped),
  });
  res.send(buffer);
});

module.exports = { exportProject };