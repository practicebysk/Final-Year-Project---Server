const mongoose = require('mongoose');
const router = require('express').Router();

router.get('/', (_req, res) => {
  const database = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  const success = database === 'connected';

  res.status(success ? 200 : 503).json({
    success,
    status: success ? 'ok' : 'unavailable',
    database,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
