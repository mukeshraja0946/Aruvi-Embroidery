const db = require('../config/db');

const fallbackCustomOrders = [
  {
    id: 1,
    user_id: 2,
    full_name: 'Priya Lakshmi',
    email: 'customer@aruviembroidery.com',
    phone: '+91 91234 56789',
    design_details: 'Need a custom 10x14 inch jumbo peacock neck design for silk saree blouse with zardozi thread density.',
    reference_image_url: '/public/images/logo.jpg',
    status: 'reviewing',
    created_at: new Date()
  }
];

class CustomOrder {
  static async create({ userId = null, full_name, email, phone = null, design_details, reference_image_url = null }) {
    if (db.isConnected()) {
      const res = await db.query(
        `INSERT INTO custom_orders (user_id, full_name, email, phone, design_details, reference_image_url, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [userId || null, full_name, email, phone, design_details, reference_image_url]
      );
      return res.insertId;
    }

    const newId = fallbackCustomOrders.length + 1;
    const req = {
      id: newId,
      user_id: userId,
      full_name,
      email,
      phone,
      design_details,
      reference_image_url: reference_image_url || '/public/images/logo.jpg',
      status: 'pending',
      created_at: new Date()
    };
    fallbackCustomOrders.push(req);
    return newId;
  }

  static async getAll({ page = 1, limit = 20 } = {}) {
    if (db.isConnected()) {
      try {
        const offset = (page - 1) * limit;
        const requests = await db.query('SELECT * FROM custom_orders ORDER BY created_at DESC LIMIT ? OFFSET ?', [parseInt(limit), parseInt(offset)]);
        const countRes = await db.query('SELECT COUNT(*) as total FROM custom_orders');
        if (requests && Array.isArray(requests)) {
          return { requests, total: (countRes && countRes[0] && countRes[0].total !== undefined) ? countRes[0].total : requests.length };
        }
      } catch (err) {
        console.error('CustomOrder.getAll DB error:', err.message);
      }
    }
    return { requests: fallbackCustomOrders, total: fallbackCustomOrders.length };
  }

  static async getById(id) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM custom_orders WHERE id = ? LIMIT 1', [id]);
      return (rows && rows[0]) ? rows[0] : null;
    }
    return fallbackCustomOrders.find(r => r.id == id) || null;
  }

  static async updateStatus(id, status, admin_notes = null) {
    if (db.isConnected()) {
      await db.query('UPDATE custom_orders SET status = ?, admin_notes = COALESCE(?, admin_notes) WHERE id = ?', [status, admin_notes, id]);
      return true;
    }
    const r = fallbackCustomOrders.find(item => item.id == id);
    if (r) {
      r.status = status;
      if (admin_notes) r.admin_notes = admin_notes;
    }
    return true;
  }

  static async count() {
    if (db.isConnected()) {
      try {
        const res = await db.query('SELECT COUNT(*) as total FROM custom_orders');
        if (res && res[0] && res[0].total !== undefined) return res[0].total;
      } catch (err) {
        console.error('CustomOrder.count DB error:', err.message);
      }
    }
    return fallbackCustomOrders.length;
  }
}

module.exports = CustomOrder;
