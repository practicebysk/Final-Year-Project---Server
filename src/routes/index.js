const router = require('express').Router();

router.use('/health', require('./health.routes'));
router.use('/auth', require('./auth.routes'));
router.use('/projects', require('./project.routes'));
router.use('/websites', require('./website.routes'));

module.exports = router;