const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyFailure } = require('../scripts/mongo-diagnose');

// Mocked classification tests only; no real MongoDB connection is made.
test('SRV failures are reported as network/DNS, not authentication', () => {
  assert.match(classifyFailure('srv-discovery', { code: 'ECONNREFUSED' }), /NETWORK\/DNS/);
});
test('TCP failures are reported as network', () => {
  assert.match(classifyFailure('tcp-reachability', { code: 'ETIMEDOUT' }), /^NETWORK/);
});
test('bad credentials are reported as authentication', () => {
  assert.match(classifyFailure('connect-auth', { message: 'bad auth : Authentication failed.' }), /^AUTHENTICATION/);
});
