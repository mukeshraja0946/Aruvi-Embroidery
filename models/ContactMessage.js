const db = require('../config/db');

const fallbackMessages = [
  { id: 1, name: 'Ananya Ramesh', email: 'ananya@example.com', subject: 'Custom Embroidery Hoop Size Inquiry', message: 'Hi! Do you provide 10x14 inch jumbo hoop format for Brother embroidery machines?', status: 'new', created_at: new Date('2026-10-01T09:30:00Z') }
];

class ContactMessage {
  static async create({ name, email, subject, message }) {
    if (db.isConnected()) {
      const res = await db.query(
        'INSERT INTO contact_messages (name, email, subject, message, status) VALUES (?, ?, ?, ?, "new")',
        [name, email, subject, message]
      );
      return res.insertId;
    }
    const newId = fallbackMessages.length + 1;
    const msg = { id: newId, name, email, subject, message, status: 'new', created_at: new Date() };
    fallbackMessages.push(msg);
    return newId;
  }

  static async getAll({ page = 1, limit = 20 } = {}) {
    if (db.isConnected()) {
      const offset = (page - 1) * limit;
      const messages = await db.query('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT ? OFFSET ?', [parseInt(limit), parseInt(offset)]);
      const countRes = await db.query('SELECT COUNT(*) as total FROM contact_messages');
      return { messages, total: countRes[0].total };
    }
    return { messages: fallbackMessages, total: fallbackMessages.length };
  }

  static async updateStatus(id, status) {
    if (db.isConnected()) {
      await db.query('UPDATE contact_messages SET status = ? WHERE id = ?', [status, id]);
      return true;
    }
    const msg = fallbackMessages.find(m => m.id == id);
    if (msg) msg.status = status;
    return true;
  }
}

module.exports = ContactMessage;
