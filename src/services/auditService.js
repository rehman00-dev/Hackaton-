const { collection, currentTimestamp } = require('../db');

function audit(actorId, action, entity, details = {}) {
  return collection('auditLogs').insertOne({
    actor_id: actorId ? String(actorId) : null,
    action,
    entity,
    details: JSON.stringify(details),
    created_at: currentTimestamp()
  });
}

function notify(userId, title, message) {
  return collection('notifications').insertOne({
    user_id: String(userId),
    title,
    message,
    read_at: null,
    created_at: currentTimestamp()
  });
}

module.exports = { audit, notify };
