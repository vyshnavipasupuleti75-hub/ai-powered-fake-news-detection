const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { port, jwtSecret } = require('./config/env');
const app = require('./app');
const connectDb = require('./config/db');
const { diagnoseMongoError } = require('./config/db');
const mongoose = require('mongoose');

let shuttingDown = false;
let retryTimer;
let retryDelay = 5000;

async function connectDatabase() {
  try {
    const connected = await connectDb();
    if (connected) retryDelay = 5000;
  } catch (error) {
    const code = [error?.code, error?.cause?.code, error?.reason?.code].find(value => typeof value === 'string' && /^[A-Z0-9_]+$/i.test(value));
    console.error(`MongoDB connection failed at stage=${error?.mongoStage || 'unknown'}${code ? ` (${code})` : ''}: ${diagnoseMongoError(error)}`);
    if (!shuttingDown && process.env.MONGODB_URI && !['MONGODB_URI_INVALID', 'MONGODB_DNS_SERVERS_INVALID'].includes(error.code)) {
      retryTimer = setTimeout(connectDatabase, retryDelay);
      retryTimer.unref();
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
  }
}

const server = app.listen(port);
server.once('listening', () => {
  console.log(`Verity Desk API listening on port ${port}`);
  if (!jwtSecret) console.warn('JWT_SECRET is not configured. Authentication endpoints will return 503.');
  connectDatabase();
});
server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Another Verity Desk backend (or other process) owns it; this instance will exit. Find it with: Get-NetTCPConnection -LocalPort ${port} -State Listen`);
    process.exit(1);
  } else {
    console.error(`HTTP server failed to start (${error.code || 'unknown error'}).`);
  }
  process.exitCode = 1;
});

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (retryTimer) clearTimeout(retryTimer);
  server.close(async () => {
    if (mongoose.connection.readyState) await mongoose.disconnect().catch(() => {});
  });
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
