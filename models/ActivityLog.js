const db = require('../config/db');

const fallbackActivityLogs = [];

class ActivityLog {
  /**
   * Log an administrative action
   */
  static async log({ userId = null, adminName = 'Admin', action, entityType, entityId = null, details = null, ipAddress = null }) {
    if (db.isConnected()) {
      try {
        await db.query(
          `INSERT INTO activity_logs (user_id, admin_name, action, entity_type, entity_id, details, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, adminName, action, entityType, entityId ? String(entityId) : null, details, ipAddress]
        );
        return;
      } catch (err) {
        console.error('[ActivityLog Error]:', err.message);
      }
    }

    const logEntry = {
      id: fallbackActivityLogs.length + 1,
      user_id: userId,
      admin_name: adminName,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
      ip_address: ipAddress,
      created_at: new Date()
    };
    fallbackActivityLogs.unshift(logEntry);
    if (fallbackActivityLogs.length > 100) fallbackActivityLogs.pop();
  }

  /**
   * Helper that extracts admin details from Express request object
   */
  static async logFromReq(req, action, entityType, entityId = null, details = null) {
    const user = req && req.user ? req.user : null;
    const adminName = user ? (user.full_name || user.email || 'Admin') : 'Admin';
    const userId = user ? user.id : null;
    const ipAddress = req ? (req.ip || (req.connection && req.connection.remoteAddress) || null) : null;
    return this.log({ userId, adminName, action, entityType, entityId, details, ipAddress });
  }

  /**
   * Fetch recent activity logs
   */
  static async getRecent(limit = 10) {
    if (db.isConnected()) {
      try {
        const rows = await db.query(
          `SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ?`,
          [parseInt(limit)]
        );
        if (rows && Array.isArray(rows)) return rows;
      } catch (err) {
        console.error('ActivityLog.getRecent DB error:', err.message);
      }
    }
    return fallbackActivityLogs.slice(0, limit);
  }
}

module.exports = ActivityLog;
