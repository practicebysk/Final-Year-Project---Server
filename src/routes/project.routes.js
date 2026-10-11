const router = require('express').Router();
const controller = require('../controllers/project.controller');
const { protect } = require('../middleware/auth.middleware');
const exporter = require('../controllers/export.controller');
const { exportLimiter } = require('../middleware/export-limiter');

router.use(protect); // every project route requires a valid JWT

router.route('/').post(controller.create).get(controller.list);
router.route('/:id').get(controller.getOne).put(controller.update).delete(controller.remove);
router.post('/:id/duplicate', controller.duplicate);

const versions = require('../controllers/version.controller');

router.get('/:id/versions', versions.list);
router.get('/:id/versions/:number', versions.getOne);
router.post('/:id/versions/:number/restore', versions.restore);

router.post('/:id/export', exportLimiter, exporter.exportProject);
module.exports = router;