const mongoose = require('mongoose');
const dns = require('node:dns');
const { mongoUri, mongoConnectionMode, mongoStandardUri, mongoDnsServers } = require('./env');
let pingReady = false;
let connectAttempt;
const connectionAttemptTimeoutMS = 15000;

mongoose.connection.on('disconnected', () => { pingReady = false; });
mongoose.connection.on('close', () => { pingReady = false; });

function validateMongoUri(value) {
  let parsed;
  try { parsed = new URL(value); } catch { const error=new Error('MONGODB_URI is not a valid MongoDB connection URI.');error.code='MONGODB_URI_INVALID';throw error; }
  if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) || !parsed.hostname) { const error=new Error('MONGODB_URI must use mongodb:// or mongodb+srv:// and include a host.');error.code='MONGODB_URI_INVALID';throw error; }
  if (parsed.protocol === 'mongodb+srv:' && parsed.port) { const error=new Error('MONGODB_URI uses mongodb+srv:// and must not include a port.');error.code='MONGODB_URI_INVALID';throw error; }
  return parsed;
}

function getConfiguredMongoUri(mode = mongoConnectionMode, srvUri = mongoUri, standardUri = mongoStandardUri) {
  if (!['srv', 'standard'].includes(mode)) {
    const error = new Error('MONGODB_CONNECTION_MODE must be either srv or standard.');
    error.code = 'MONGODB_URI_INVALID';
    throw error;
  }
  const value = mode === 'standard' ? standardUri : srvUri;
  if (!value) {
    const error = new Error(mode === 'standard'
      ? 'MONGODB_STANDARD_URI is required when MONGODB_CONNECTION_MODE=standard. Obtain the standard connection string from MongoDB Atlas Connect > Drivers.'
      : 'MONGODB_URI is required when MONGODB_CONNECTION_MODE=srv.');
    error.code = 'MONGODB_URI_INVALID';
    throw error;
  }
  const parsed = validateMongoUri(value);
  if ((mode === 'srv' && parsed.protocol !== 'mongodb+srv:') || (mode === 'standard' && parsed.protocol !== 'mongodb:')) {
    const error = new Error(`The configured MongoDB URI scheme does not match MONGODB_CONNECTION_MODE=${mode}.`);
    error.code = 'MONGODB_URI_INVALID';
    throw error;
  }
  return value;
}

function diagnoseMongoError(error) {
  const nestedErrors = [...(error?.reason?.servers?.values?.() || [])].map(server => server.error).filter(Boolean);
  const message = [error?.message, error?.cause?.message, error?.reason?.message, ...nestedErrors.map(item => item.message)].filter(Boolean).join(' ').toLowerCase();
  const codes = [error?.code, error?.cause?.code, error?.reason?.code, ...nestedErrors.map(item => item.code)].filter(Boolean).map(String);
  if (['MONGODB_URI_INVALID', 'MONGODB_DNS_SERVERS_INVALID'].includes(error?.code)) return 'MongoDB connection configuration is invalid. Check MONGODB_URI and MONGODB_DNS_SERVERS.';
  if (error?.code === 'MONGODB_PING_FAILED') return 'MongoDB connection opened, but the database ping did not confirm readiness.';
  if (error?.code === 'MONGODB_CONNECTION_TIMEOUT') return 'MongoDB connection attempt exceeded the application deadline. Check Atlas DNS/SRV resolution and outbound network access.';
  if (message.includes('whitelist') || message.includes('ip address') && message.includes('atlas')) return 'Atlas rejected this network address. Add the backend egress IP to the Atlas Network Access allowlist.';
  if (codes.some(code => /querysrv|querytxt|enotfound|eservfail|eai_again|etimeout/i.test(code)) || /querysrv|querytxt|getaddrinfo/i.test(message)) return 'MongoDB DNS/SRV lookup failed. Check the Atlas hostname and DNS resolver/network access.';
  if (codes.some(code => ['18', '8000', 'AUTHENTICATIONFAILED'].includes(code.toUpperCase())) || /authentication failed|bad auth|auth failed/i.test(message)) return 'MongoDB authentication failed. Check the database username, password, and authentication database.';
  if (codes.some(code => /tls|ssl|cert|x509/i.test(code)) || /tls|ssl|certificate|x509/i.test(message)) return 'MongoDB TLS negotiation failed. Check system time, certificate trust, and network TLS inspection; TLS verification remains enabled.';
  if (codes.some(code => /etimedout|econnrefused|econnreset|ehostunreach|enetunreach|enetdown/i.test(code)) || /server selection timed out|connection timed out|network timeout/i.test(message)) return 'MongoDB network connection timed out or was refused. Check outbound access, firewall rules, and Atlas availability.';
  return 'MongoDB connection failed. Check the URI format, Atlas network access, credentials, and cluster status.';
}

function configureDnsServers(servers) {
  if (!Array.isArray(servers) || servers.some(server => typeof server !== 'string' || !server.trim())) {
    const error = new Error('MONGODB_DNS_SERVERS must be a comma-separated list of DNS server IP addresses.');
    error.code = 'MONGODB_DNS_SERVERS_INVALID';
    throw error;
  }
  // Node's supported DNS API accepts resolver IP addresses (optionally with ports).
  // Keep this opt-in; never silently replace the machine's DNS configuration.
  if (servers.length) dns.setServers(servers);
}

async function connectDb() {
  if (pingReady && mongoose.connection.readyState === 1) return true;
  if (connectAttempt) return connectAttempt;
  const attemptState = { active: true, stage: 'configuration' };
  const operation = (async () => {
    pingReady = false;
    const tagStage = error => { if (error && typeof error === 'object' && !error.mongoStage) error.mongoStage = attemptState.stage; return error; };
    let uri;
    try {
      uri = getConfiguredMongoUri();
      configureDnsServers(mongoDnsServers);
    } catch (error) { throw tagStage(error); }
    const host = new URL(uri).hostname;
    console.log(`MongoDB [configuration] ok: mode=${mongoConnectionMode}, host=${host}`);
    try {
      if (uri.startsWith('mongodb+srv:')) {
        attemptState.stage = 'srv-discovery';
        const records = await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
        console.log(`MongoDB [srv-discovery] ok: ${records.length} SRV record(s)`);
      }
      attemptState.stage = 'tcp-server-selection';
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000, family: 4 });
      console.log('MongoDB [tcp-server-selection/authentication] ok');
      attemptState.stage = 'ping';
      const ping = await mongoose.connection.db.admin().ping();
      if (ping.ok !== 1) {
        const error = new Error('MongoDB ping did not confirm database readiness.');
        error.code = 'MONGODB_PING_FAILED';
        throw error;
      }
      if (!attemptState.active) {
        await mongoose.disconnect().catch(() => {});
        return false;
      }
      pingReady = true;
      console.log('MongoDB connected and ping succeeded');
      return true;
    } catch (error) {
      if (attemptState.stage === 'tcp-server-selection' && /authentication failed|bad auth|auth failed/i.test(String(error?.message))) error.mongoStage = 'authentication';
      tagStage(error);
      if (attemptState.active) pingReady = false;
      if (mongoose.connection.readyState !== 0) void mongoose.disconnect().catch(() => {});
      throw error;
    }
  })();
  const boundedAttempt = withConnectionTimeout(operation, connectionAttemptTimeoutMS, () => {
    attemptState.active = false;
    pingReady = false;
  });
  connectAttempt = boundedAttempt;
  // A resolver may leave the underlying driver operation pending after our deadline.
  // Keep the single-flight guard until that operation settles; do not launch a second
  // Mongoose connect while the first driver attempt is still alive.
  operation.then(
    () => { if (connectAttempt === boundedAttempt) connectAttempt = undefined; },
    () => { if (connectAttempt === boundedAttempt) connectAttempt = undefined; }
  );
  try { return await boundedAttempt; }
  catch (error) {
    attemptState.active = false;
    if (error.code === 'MONGODB_CONNECTION_TIMEOUT') error.mongoStage = attemptState.stage;
    if (error.code === 'MONGODB_CONNECTION_TIMEOUT' && mongoose.connection.readyState !== 0) {
      void mongoose.disconnect().catch(() => {});
    }
    throw error;
  }
}

function getDbHealth() {
  const state = mongoose.connection.readyState;
  const connected = isDatabaseReady(pingReady, state);
  return { connected, database: connected ? 'connected' : state === 1 || state === 2 ? 'connecting' : 'disconnected' };
}

function isDatabaseReady(pingSucceeded, connectionState) {
  return pingSucceeded === true && connectionState === 1;
}

function withConnectionTimeout(operation, timeoutMS, onTimeout = () => {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      const error = new Error('MongoDB connection attempt exceeded its application deadline.');
      error.code = 'MONGODB_CONNECTION_TIMEOUT';
      reject(error);
    }, timeoutMS);
    Promise.resolve(operation).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); }
    );
  });
}

module.exports = connectDb;
module.exports.diagnoseMongoError = diagnoseMongoError;
module.exports.validateMongoUri = validateMongoUri;
module.exports.getConfiguredMongoUri = getConfiguredMongoUri;
module.exports.configureDnsServers = configureDnsServers;
module.exports.getDbHealth = getDbHealth;
module.exports.isDatabaseReady = isDatabaseReady;
module.exports.connectionAttemptTimeoutMS = connectionAttemptTimeoutMS;
module.exports.withConnectionTimeout = withConnectionTimeout;
