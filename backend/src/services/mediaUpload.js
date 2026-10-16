const multer = require('multer');
const { maxImageBytes, maxVideoBytes } = require('../config/env');

const IMAGE_MIMES = { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' };
const VIDEO_MIMES = { 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

function fail(message, status = 400) { return Object.assign(new Error(message), { status, expose: true }); }

// Files are held in memory only (never written under a client-controlled name) and are forwarded to the
// AI service, which writes a randomly named temp file and deletes it in a finally block.
function uploader(kind) {
  const mimes = kind === 'image' ? IMAGE_MIMES : VIDEO_MIMES;
  const limit = kind === 'image' ? maxImageBytes : maxVideoBytes;
  const instance = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: limit, files: 1, fields: 4, parts: 6 },
    fileFilter: (_req, file, cb) => (mimes[file.mimetype] ? cb(null, true) : cb(fail(kind === 'image' ? 'Upload a JPEG, PNG, or WEBP image.' : 'Upload an MP4 or MOV video.', 415)))
  }).single('file');
  return (req, res, next) => instance(req, res, err => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return next(fail(`The file is larger than the ${Math.round(limit / 1048576)} MB limit.`, 413));
    if (err instanceof multer.MulterError) return next(fail('The upload was not understood. Send a single file in the "file" field.'));
    return next(err);
  });
}

// Validates the real file signature, not just the client-declared MIME type.
function detectKind(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 4, 8) === 'ftyp') return buf.toString('ascii', 8, 12) === 'qt  ' ? 'video/quicktime' : 'video/mp4';
  return null;
}

function requireValidFile(kind) {
  return (req, _res, next) => {
    if (!req.file) return next(fail('Choose a file to upload.'));
    const actual = detectKind(req.file.buffer);
    const allowed = Object.keys(kind === 'image' ? IMAGE_MIMES : VIDEO_MIMES);
    const mp4Family = kind === 'video' && actual && actual.startsWith('video/');
    if (!actual || (!mp4Family && actual !== req.file.mimetype) || !allowed.includes(kind === 'video' ? req.file.mimetype : actual)) {
      return next(fail('The file contents do not match a supported ' + kind + ' format.', 415));
    }
    next();
  };
}

module.exports = { uploader, requireValidFile, detectKind };
