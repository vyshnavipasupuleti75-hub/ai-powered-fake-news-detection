const AuditLog = require('../models/AuditLog');
module.exports = (actorId, action, resourceType, resourceId, metadata = {}) => AuditLog.create({ actorId: actorId || null, action, resourceType, resourceId: resourceId ? String(resourceId) : undefined, metadata }).catch(() => {});
