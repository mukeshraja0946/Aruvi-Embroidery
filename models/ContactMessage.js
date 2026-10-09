const db = require('../config/db');

// In-memory fallback container for local fallback mode (starts completely empty)
const fallbackMessages = [];

class ContactMessage {
  /**
   * Ensure table schema includes source column and remove confirmed seed/demo rows
   */
  static async initTable() {
    if (db.isConnected()) {
      try {
        await db.query(`
          CREATE TABLE IF NOT EXISTS contact_messages (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            email VARCHAR(150) NOT NULL,
            subject VARCHAR(200) DEFAULT 'General Inquiry',
            message TEXT NOT NULL,
            status ENUM('new', 'read', 'replied') NOT NULL DEFAULT 'new',
            source VARCHAR(50) DEFAULT 'customer_form',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `);

        // Check if source column exists
        const columns = await db.query('SHOW COLUMNS FROM contact_messages LIKE "source"');
        if (!columns || columns.length === 0) {
          await db.query('ALTER TABLE contact_messages ADD COLUMN source VARCHAR(50) DEFAULT "customer_form"');
        }

        // Clean up confirmed seed/demo records (e.g. ananya@example.com placeholder)
        await db.query('DELETE FROM contact_messages WHERE email LIKE "%@example.com" OR name = "Ananya Ramesh"');
      } catch (err) {
        console.error('[ContactMessage initTable Error]:', err.message);
      }
    }
  }

  /**
   * Create a genuine enquiry record
   */
  static async create({ name, email, subject = 'General Inquiry', message, status = 'new', source = 'customer_form' }) {
    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanSubject = (subject || 'General Inquiry').trim();
    const cleanMessage = (message || '').trim();
    const cleanStatus = ['new', 'read', 'replied'].includes(status) ? status : 'new';
    const cleanSource = (source || 'customer_form').trim();

    if (db.isConnected()) {
      const res = await db.query(
        'INSERT INTO contact_messages (name, email, subject, message, status, source) VALUES (?, ?, ?, ?, ?, ?)',
        [cleanName, cleanEmail, cleanSubject, cleanMessage, cleanStatus, cleanSource]
      );
      return res.insertId;
    }

    const newId = fallbackMessages.length + 1;
    const msg = {
      id: newId,
      name: cleanName,
      email: cleanEmail,
      subject: cleanSubject,
      message: cleanMessage,
      status: cleanStatus,
      source: cleanSource,
      created_at: new Date()
    };
    fallbackMessages.push(msg);
    return newId;
  }

  /**
   * Check for duplicate submissions within last 30 seconds
   */
  static async findRecentDuplicate(email, message) {
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanMessage = (message || '').trim();

    if (db.isConnected()) {
      try {
        const rows = await db.query(
          'SELECT id FROM contact_messages WHERE LOWER(email) = ? AND message = ? AND created_at > NOW() - INTERVAL 30 SECOND LIMIT 1',
          [cleanEmail, cleanMessage]
        );
        return rows && rows.length > 0 ? rows[0] : null;
      } catch (err) {
        return null;
      }
    }

    const thirtySecAgo = new Date(Date.now() - 30000);
    return fallbackMessages.find(m =>
      m.email.toLowerCase() === cleanEmail &&
      m.message === cleanMessage &&
      new Date(m.created_at) > thirtySecAgo
    ) || null;
  }

  /**
   * Get paginated enquiries
   */
  static async getAll({ page = 1, limit = 20, status = null, search = null } = {}) {
    if (db.isConnected()) {
      const offset = (page - 1) * limit;
      let sql = 'SELECT * FROM contact_messages WHERE 1=1';
      const params = [];

      if (status && ['new', 'read', 'replied'].includes(status)) {
        sql += ' AND status = ?';
        params.push(status);
      }

      if (search && search.trim()) {
        sql += ' AND (name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ?)';
        const q = `%${search.trim()}%`;
        params.push(q, q, q, q);
      }

      sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
      params.push(parseInt(limit), parseInt(offset));

      const messages = await db.query(sql, params);

      let countSql = 'SELECT COUNT(*) as total FROM contact_messages WHERE 1=1';
      const countParams = [];

      if (status && ['new', 'read', 'replied'].includes(status)) {
        countSql += ' AND status = ?';
        countParams.push(status);
      }

      if (search && search.trim()) {
        countSql += ' AND (name LIKE ? OR email LIKE ? OR subject LIKE ? OR message LIKE ?)';
        const q = `%${search.trim()}%`;
        countParams.push(q, q, q, q);
      }

      const countRes = await db.query(countSql, countParams);
      return { messages, total: countRes[0].total };
    }

    let filtered = [...fallbackMessages];
    if (status && ['new', 'read', 'replied'].includes(status)) {
      filtered = filtered.filter(m => m.status === status);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.message.toLowerCase().includes(q)
      );
    }
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return { messages: filtered, total: filtered.length };
  }

  /**
   * Update status of an enquiry
   */
  static async updateStatus(id, status) {
    const cleanStatus = ['new', 'read', 'replied'].includes(status) ? status : 'new';
    if (db.isConnected()) {
      await db.query('UPDATE contact_messages SET status = ? WHERE id = ?', [cleanStatus, id]);
      return true;
    }
    const msg = fallbackMessages.find(m => m.id == id);
    if (msg) msg.status = cleanStatus;
    return true;
  }

  /**
   * Delete an enquiry
   */
  static async delete(id) {
    if (db.isConnected()) {
      await db.query('DELETE FROM contact_messages WHERE id = ?', [id]);
      return true;
    }
    const idx = fallbackMessages.findIndex(m => m.id == id);
    if (idx !== -1) fallbackMessages.splice(idx, 1);
    return true;
  }
}

// Run DB table initialization
ContactMessage.initTable();

module.exports = ContactMessage;
