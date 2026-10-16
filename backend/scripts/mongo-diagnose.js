// Safe staged MongoDB diagnostic. Never prints credentials or the full URI.
// Usage: node scripts/mongo-diagnose.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const dns = require('node:dns');
const net = require('node:net');

function classifyFailure(stage, error) {
  const text = `${error?.code || ''} ${error?.cause?.code || ''} ${error?.message || ''}`.toLowerCase();
  if (/authentication failed|bad auth|auth failed/.test(text)) return 'AUTHENTICATION: the server was reached but rejected the username/password.';
  if (stage === 'srv-discovery') return 'NETWORK/DNS: SRV lookup failed before any server was contacted (not a credentials problem).';
  if (stage === 'tcp-reachability') return 'NETWORK: TCP port 27017 unreachable (firewall, ISP, VPN, or Atlas IP allowlist).';
  if (/tls|ssl|certificate/.test(text)) return 'TLS: negotiation failed (system clock, certificate trust, or TLS inspection).';
  if (/server selection|timed out|etimedout|econnrefused|enotfound/.test(text)) return 'NETWORK/TIMEOUT: no Atlas server could be selected in time.';
  return 'UNKNOWN: see the error code.';
}

function tcpProbe(host, port, ms = 5000) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    const fail = error => { socket.destroy(); reject(error); };
    socket.setTimeout(ms, () => fail(Object.assign(new Error('TCP connect timeout'), { code: 'ETIMEDOUT' })));
    socket.once('error', fail);
    socket.once('connect', () => { socket.destroy(); resolve(); });
  });
}

async function run() {
  const mode = (process.env.MONGODB_CONNECTION_MODE || 'srv').trim().toLowerCase();
  const raw = mode === 'standard' ? process.env.MONGODB_STANDARD_URI : process.env.MONGODB_URI;
  let stage = 'configuration';
  const report = name => console.log(`[ok] ${name}`);
  try {
    for (const key of ['MONGODB_URI', 'MONGODB_CONNECTION_MODE', 'MONGODB_STANDARD_URI', 'MONGODB_DNS_SERVERS', 'JWT_SECRET']) {
      console.log(`${key}: ${process.env[key] ? 'set' : 'NOT SET'}`);
    }
    if (!raw) throw Object.assign(new Error('Connection URI for the selected mode is not set'), { code: 'MONGODB_URI_INVALID' });
    const parsed = new URL(raw);
    report(`configuration (mode=${mode}, scheme=${parsed.protocol}, host=${parsed.hostname})`);
    const dnsServers = (process.env.MONGODB_DNS_SERVERS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (dnsServers.length) dns.setServers(dnsServers);
    let targets = [{ name: parsed.hostname, port: Number(parsed.port) || 27017 }];
    if (parsed.protocol === 'mongodb+srv:') {
      stage = 'srv-discovery';
      const records = await dns.promises.resolveSrv(`_mongodb._tcp.${parsed.hostname}`);
      targets = records.map(r => ({ name: r.name, port: r.port }));
      report(`srv-discovery (${records.length} records)`);
    }
    stage = 'tcp-reachability';
    await tcpProbe(targets[0].name, targets[0].port);
    report(`tcp-reachability (${targets[0].name}:${targets[0].port})`);
    stage = 'connect-auth';
    const mongoose = require('mongoose');
    await mongoose.connect(raw, { serverSelectionTimeoutMS: 12000, connectTimeoutMS: 8000, family: 4 });
    report('connect + authentication');
    stage = 'ping';
    const ping = await mongoose.connection.db.admin().ping();
    await mongoose.disconnect();
    if (ping.ok !== 1) throw new Error('ping not ok');
    report('admin ping');
    console.log('RESULT: MongoDB reachable and ping succeeded.');
    return 0;
  } catch (error) {
    console.log(`[fail] stage=${stage} code=${error?.code || error?.cause?.code || 'n/a'}`);
    console.log(`RESULT: ${classifyFailure(stage, error)}`);
    return 1;
  }
}

module.exports = { classifyFailure };
if (require.main === module) run().then(code => process.exit(code));
