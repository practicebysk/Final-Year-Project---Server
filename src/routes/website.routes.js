const router = require('express').Router();
const controller = require('../controllers/website.controller');
const { protect } = require('../middleware/auth.middleware');
const { generationLimiter } = require('../middleware/generation-limiter');

router.use(protect);
router.post('/generate', generationLimiter, controller.generate);
router.post('/modify', generationLimiter, controller.modify);

module.exports = router;