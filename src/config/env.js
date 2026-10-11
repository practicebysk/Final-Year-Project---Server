const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const required = ['MONGODB_URI', 'JWT_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
if (process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters long');
}

const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!/^[\w.\-]+$/.test(geminiModel)) {
  throw new Error('GEMINI_MODEL contains invalid characters');
}

const geminiFallbackModel = process.env.GEMINI_FALLBACK_MODEL || 'gemini-flash-latest';
if (geminiFallbackModel && !/^[\w.\-]+$/.test(geminiFallbackModel)) {
  throw new Error('GEMINI_FALLBACK_MODEL contains invalid characters');
}

if (!process.env.GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not set. POST /api/websites/generate will return 503.');
}

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 3000,
  clientUrl: process.env.CLIENT_URL || 'http://localhost:4200',
  mongoUri: process.env.MONGODB_URI,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  bcryptRounds: 12,
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel,
  geminiFallbackModels: geminiFallbackModel ? [geminiFallbackModel] : [],
  geminiTimeoutMs: Number(process.env.GEMINI_TIMEOUT_MS) || 90000,
  geminiMaxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS) || 32768,
};