const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
module.exports = {
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || 'development',
  mongoUri: process.env.MONGODB_URI || '',
  mongoConnectionMode: (process.env.MONGODB_CONNECTION_MODE || 'srv').trim().toLowerCase(),
  mongoStandardUri: process.env.MONGODB_STANDARD_URI || '',
  mongoDnsServers: (process.env.MONGODB_DNS_SERVERS || '').split(',').map(value => value.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || '',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  // The FastAPI service does classification, OCR, video frames and speech. MEDIA_SERVICE_URL is the preferred name; AI_SERVICE_URL still works.
  aiServiceUrl: process.env.AI_SERVICE_URL || process.env.MEDIA_SERVICE_URL || '',
  mediaServiceUrl: process.env.MEDIA_SERVICE_URL || process.env.AI_SERVICE_URL || '',
  evidenceApiKey: process.env.EVIDENCE_API_KEY || '',
  maxImageBytes: Number(process.env.MAX_IMAGE_MB || 8) * 1048576,
  maxVideoBytes: Number(process.env.MAX_VIDEO_MB || 50) * 1048576,
  mediaTimeoutMs: Number(process.env.MEDIA_TIMEOUT_SECONDS || 120) * 1000
};
