const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { validatePublicUrl } = require('../src/services/urlSafety');
const { analyze } = require('../src/services/analyzer');
const { clientUrl } = require('../src/config/env');
const { diagnoseMongoError, validateMongoUri, getConfiguredMongoUri, configureDnsServers, getDbHealth, isDatabaseReady, connectionAttemptTimeoutMS, withConnectionTimeout } = require('../src/config/db');

let server;
let base;
before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => new Promise(resolve => server.close(resolve)));

test('root and API health endpoints report degraded while MongoDB is disconnected', async () => {
  for (const path of ['/health', '/api/health']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, 'degraded');
    assert.equal(body.service, 'verity-desk-api');
    assert.equal(body.database, 'disconnected');
  }
  assert.deepEqual(getDbHealth(), { connected: false, database: 'disconnected' });
});

test('CORS never reflects an arbitrary request origin', async () => {
  const allowed = await fetch(`${base}/api/health`, { headers: { Origin: clientUrl } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), clientUrl);
  const denied = await fetch(`${base}/api/health`, { headers: { Origin: 'https://attacker.example' } });
  assert.equal(denied.headers.get('access-control-allow-origin'), clientUrl);
  assert.notEqual(denied.headers.get('access-control-allow-origin'), 'https://attacker.example');
});

test('verification and user data APIs require authentication', async () => {
  for (const path of ['/api/verify/history', '/api/dashboard/stats', '/api/profile', '/api/admin/stats']) {
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 401, `${path} must reject anonymous requests`);
  }
  const submit = await fetch(`${base}/api/verify/text`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A sufficiently long test claim without any evidence or classification.' }) });
  assert.equal(submit.status, 401);
});

test('registration and login reject invalid input before attempting database access', async () => {
  const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'A', email: 'bad', password: 'short' }) });
  assert.equal(registration.status, 400);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: '', password: '' }) });
  assert.equal(login.status, 400);
});

test('valid registration and login requests fail fast with 503 when MongoDB is disconnected', async () => {
  const registration = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Test Reader', email: 'reader@example.test', password: 'LongEnough-Password-123' }) });
  assert.equal(registration.status, 503);
  assert.match((await registration.json()).message, /Database is unavailable/);
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'reader@example.test', password: 'LongEnough-Password-123' }) });
  assert.equal(login.status, 503);
  assert.match((await login.json()).message, /Database is unavailable/);
});

test('logout clears the HttpOnly session cookie', async () => {
  const response = await fetch(`${base}/api/auth/logout`, { method: 'POST' });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie') || '';
  assert.match(cookie, /verity_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /1970|Max-Age=0/i);
});

test('URL retrieval rejects local and private network destinations', async () => {
  for (const url of ['http://localhost/', 'http://127.0.0.1/', 'http://10.0.0.1/', 'http://192.168.1.2/', 'http://[::1]/', 'http://[::ffff:7f00:1]/']) {
    await assert.rejects(validatePublicUrl(url), { status: 400 }, url);
  }
});

test('URL retrieval only accepts HTTP and HTTPS', async () => {
  await assert.rejects(validatePublicUrl('file:///etc/passwd'), { status: 400 });
});

test('analysis never fabricates a prediction when no model service is configured', async () => {
  if (process.env.AI_SERVICE_URL) return;
  const result = await analyze('A sufficiently long claim to test the unavailable model path.');
  assert.equal(result.prediction, 'INCONCLUSIVE');
  assert.equal(result.confidence, null);
  assert.equal(result.processingStatus, 'unavailable');
  assert.deepEqual(result.supportingEvidence, []);
});

test('MongoDB diagnostics identify common failure classes without echoing connection details', () => {
  assert.match(diagnoseMongoError({ code: 'ECONNREFUSED', message: 'querySrv ECONNREFUSED' }), /DNS\/SRV/);
  assert.match(diagnoseMongoError({ code: 18, message: 'Authentication failed' }), /authentication failed/i);
  assert.match(diagnoseMongoError({ message: 'IP address is not whitelisted for this Atlas cluster' }), /allowlist/i);
  assert.match(diagnoseMongoError({ code: 'ETIMEDOUT', message: 'timeout' }), /timed out or was refused/i);
  assert.match(diagnoseMongoError({ code: 'ETIMEOUT', syscall: 'querySrv' }), /DNS\/SRV/);
  assert.match(diagnoseMongoError({ code: 'ETIMEOUT', syscall: 'queryTxt' }), /DNS\/SRV/);
  assert.match(diagnoseMongoError({ code: 'MONGODB_PING_FAILED' }), /ping did not confirm readiness/i);
  assert.match(diagnoseMongoError({ code: 'MONGODB_CONNECTION_TIMEOUT' }), /application deadline/i);
  assert.match(diagnoseMongoError({ code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: 'certificate hostname mismatch' }), /TLS negotiation failed/i);
  assert.match(diagnoseMongoError({ code: 'MONGODB_URI_INVALID' }), /configuration is invalid/i);
  assert.throws(() => validateMongoUri('not-a-mongodb-uri'), /MONGODB_URI/);
  assert.equal(validateMongoUri('mongodb+srv://user:pass@cluster.example.mongodb.net/db').protocol, 'mongodb+srv:');
  assert.equal(getConfiguredMongoUri('srv', 'mongodb+srv://user:pass@cluster.example.mongodb.net/db', '').startsWith('mongodb+srv://'), true);
  assert.equal(getConfiguredMongoUri('standard', '', 'mongodb://user:pass@node.example:27017/db?tls=true').startsWith('mongodb://'), true);
  assert.throws(() => getConfiguredMongoUri('standard', '', ''), /Atlas Connect > Drivers/);
  assert.throws(() => getConfiguredMongoUri('standard', '', 'mongodb+srv://user:pass@cluster.example.mongodb.net/db'), { code: 'MONGODB_URI_INVALID' });
  const secret = 'password-that-must-not-leak';
  assert.doesNotMatch(diagnoseMongoError({ code: 'ETIMEDOUT', message: `failed for mongodb://user:${secret}@host/db` }), new RegExp(secret));
  assert.throws(() => configureDnsServers(['']), { code: 'MONGODB_DNS_SERVERS_INVALID' });
});

test('MongoDB ping readiness is not asserted by configuration or connection alone', () => {
  assert.deepEqual(getDbHealth(), { connected: false, database: 'disconnected' });
  assert.equal(isDatabaseReady(false, 1), false);
  assert.equal(isDatabaseReady(true, 0), false);
  assert.equal(isDatabaseReady(true, 2), false);
  assert.equal(isDatabaseReady(true, 1), true);
  assert.equal(connectionAttemptTimeoutMS, 15000);
});

test('MongoDB connection deadline rejects a stalled attempt and runs cleanup', async () => {
  let cleanedUp = false;
  const stalled = new Promise(() => {});
  await assert.rejects(withConnectionTimeout(stalled, 5, () => { cleanedUp = true; }), { code: 'MONGODB_CONNECTION_TIMEOUT' });
  assert.equal(cleanedUp, true);
});
