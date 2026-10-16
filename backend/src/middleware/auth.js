const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
const { jwtSecret } = require('../config/env');
const User = require('../models/User');
async function requireAuth(req, res, next) {
  try { const token = req.cookies?.verity_session; if (!token || !jwtSecret) return res.status(401).json({ message: 'Please sign in to continue.' }); const payload = jwt.verify(token, jwtSecret); if (mongoose.connection.readyState !== 1) return res.status(503).json({ message: 'Database is unavailable. Try again after the database connection is restored.' }); const user = await User.findById(payload.sub).select('+tokenVersion'); if (!user || (payload.ver ?? 0) !== user.tokenVersion) return res.status(401).json({ message: 'Session is no longer valid.' }); if (['POST','PATCH','PUT','DELETE'].includes(req.method) && req.get('origin') !== require('../config/env').clientUrl) return res.status(403).json({ message: 'Request origin could not be verified.' }); req.user = user; next(); } catch { return res.status(401).json({ message: 'Please sign in to continue.' }); }
}
function requireAdmin(req, res, next) { if (req.user?.role !== 'admin') return res.status(403).json({ message: 'Administrator access is required.' }); next(); }
module.exports = { requireAuth, requireAdmin };
