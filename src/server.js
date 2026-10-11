const cors = require('cors');
const express = require('express');
const mongoose = require('mongoose');
const env = require('./config/env');
const apiRoutes = require('./routes');
const AppError = require('./utils/AppError');
const helmet = require('helmet');
const app = express();

app.use(cors({ origin: env.clientUrl }));
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRoutes);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

app.use((req, _res, next) => {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404));
});

app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);

  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal server error';
  let errors = err.errors;

  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    message = 'Request body contains invalid JSON';
  } else if (err.code === 11000) {
    statusCode = 409;
    message = 'A record with that value already exists';
  } else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Request validation failed';
    errors = Object.values(err.errors).map(({ path, message: errorMessage }) => ({
      field: path,
      message: errorMessage,
    }));
  }

  if (statusCode >= 500) {
    console.error(err);
    if (!(err instanceof AppError)) message = 'Internal server error';
  }

  res.status(statusCode).json({
    success: false,
    message,
    ...(errors ? { errors } : {}),
  });
});

app.use(cors({ origin: env.clientUrl, exposedHeaders: ['X-Assets-Included', 'X-Assets-Skipped'] }));

const start = async () => {
  await mongoose.connect(env.mongoUri);
  app.listen(env.port, () => {
    console.log(`API server listening on port ${env.port}`);
  });
};

start().catch((err) => {
  console.error('Failed to start API server:', err);
  process.exitCode = 1;
});
