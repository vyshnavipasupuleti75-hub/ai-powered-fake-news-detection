const { test } = require('node:test');
const assert = require('node:assert/strict');
const { detectKind, requireValidFile } = require('../src/services/mediaUpload');
const { ratingDirection, gatherEvidence } = require('../src/services/evidence');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]);
const mp4 = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)]);
const mov = Buffer.concat([Buffer.alloc(4), Buffer.from('ftypqt  '), Buffer.alloc(8)]);

test('file signatures are detected from content, not names', () => {
  assert.equal(detectKind(png), 'image/png');
  assert.equal(detectKind(jpeg), 'image/jpeg');
  assert.equal(detectKind(webp), 'image/webp');
  assert.equal(detectKind(mp4), 'video/mp4');
  assert.equal(detectKind(mov), 'video/quicktime');
  assert.equal(detectKind(Buffer.from('MZ this is an executable........')), null);
  assert.equal(detectKind(Buffer.alloc(4)), null);
});

function run(kind, file) {
  return new Promise(resolve => requireValidFile(kind)({ file }, {}, err => resolve(err)));
}

test('upload validation rejects missing files, spoofed content and cross-kind uploads', async () => {
  assert.equal((await run('image', undefined)).status, 400);
  assert.equal((await run('image', { buffer: Buffer.from('MZ not an image at all.......'), mimetype: 'image/png' })).status, 415);
  assert.equal((await run('image', { buffer: png, mimetype: 'image/jpeg' })).status, 415); // declared type disagrees with content
  assert.equal((await run('image', { buffer: mp4, mimetype: 'image/png' })).status, 415);
  assert.equal((await run('video', { buffer: png, mimetype: 'video/mp4' })).status, 415);
  assert.equal(await run('image', { buffer: png, mimetype: 'image/png' }), undefined);
  assert.equal(await run('video', { buffer: mov, mimetype: 'video/quicktime' }), undefined);
});

test('fact-check ratings map conservatively', () => {
  assert.equal(ratingDirection('False'), 'contradicted');
  assert.equal(ratingDirection('Pants on Fire'), 'contradicted');
  assert.equal(ratingDirection('Mostly True'), 'supported');
  assert.equal(ratingDirection('Half True'), 'mixed');
  assert.equal(ratingDirection('Needs context'), 'mixed');
  assert.equal(ratingDirection('something unrecognised'), 'mixed');
});

test('evidence assessment is inconclusive when there is nothing to search', async () => {
  const result = await gatherEvidence('!!! ??? ...');
  assert.equal(result.evidenceAssessment.status, 'INCONCLUSIVE');
  assert.deepEqual(result.supportingEvidence, []);
  assert.deepEqual(result.contradictoryEvidence, []);
});
