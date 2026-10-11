const router = require('express').Router();
const { register, login, me } = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { loginLimiter, registerLimiter } = require('../middleware/rate-limit.js');

router.post('/register', registerLimiter, register);
router.post('/login', loginLimiter, login);
router.get('/me', protect, me);

module.exports = router;