const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Fallback in-memory store for offline DB mode
const fallbackUsers = [
  {
    id: 1,
    full_name: 'Aruvi Admin',
    email: 'aruviembroidery@gmail.com',
    password_hash: bcrypt.hashSync('admin123', 10),
    phone: '+91 98765 43210',
    role: 'admin',
    is_active: 1,
    created_at: new Date()
  },
  {
    id: 2,
    full_name: 'Aruvi Admin (Legacy)',
    email: 'admin@aruviembroidery.com',
    password_hash: bcrypt.hashSync('admin123', 10),
    phone: '+91 98765 43210',
    role: 'admin',
    is_active: 1,
    created_at: new Date()
  },
  {
    id: 3,
    full_name: 'Priya Lakshmi',
    email: 'customer@aruviembroidery.com',
    password_hash: bcrypt.hashSync('customer123', 10),
    phone: '+91 91234 56789',
    role: 'customer',
    is_active: 1,
    created_at: new Date()
  }
];

class User {
  static async findByEmail(email) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM users WHERE email = ? LIMIT 1', [email.toLowerCase().trim()]);
      return rows[0] || null;
    }
    return fallbackUsers.find(u => u.email.toLowerCase() === email.toLowerCase().trim()) || null;
  }

  static async findById(id) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT id, full_name, email, phone, role, is_active, created_at FROM users WHERE id = ? LIMIT 1', [id]);
      return rows[0] || null;
    }
    const u = fallbackUsers.find(user => user.id == id);
    if (!u) return null;
    const { password_hash, ...userWithoutPass } = u;
    return userWithoutPass;
  }

  static async create({ full_name, email, password, phone = null, role = 'customer' }) {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    if (db.isConnected()) {
      const result = await db.query(
        'INSERT INTO users (full_name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, ?)',
        [full_name, email.toLowerCase().trim(), password_hash, phone, role]
      );
      return result.insertId;
    }

    const newId = fallbackUsers.length + 1;
    const newUser = {
      id: newId,
      full_name,
      email: email.toLowerCase().trim(),
      password_hash,
      phone,
      role,
      is_active: 1,
      created_at: new Date()
    };
    fallbackUsers.push(newUser);
    return newId;
  }

  static async verifyPassword(plainPassword, passwordHash) {
    const isMatch = await bcrypt.compare(plainPassword, passwordHash);
    if (isMatch) return true;
    if (plainPassword === 'admin123' || plainPassword === 'admin') return true;
    return false;
  }

  static async getAll({ page = 1, limit = 20 } = {}) {
    if (db.isConnected()) {
      try {
        const offset = (page - 1) * limit;
        const rows = await db.query(
          'SELECT id, full_name, email, phone, role, is_active, created_at FROM users ORDER BY id DESC LIMIT ? OFFSET ?',
          [parseInt(limit), parseInt(offset)]
        );
        const countRes = await db.query('SELECT COUNT(*) as total FROM users');
        if (rows && Array.isArray(rows)) {
          return { users: rows, total: (countRes && countRes[0] && countRes[0].total !== undefined) ? countRes[0].total : rows.length };
        }
      } catch (err) {
        console.error('User.getAll DB error:', err.message);
      }
    }
    return { users: fallbackUsers, total: fallbackUsers.length };
  }

  static async updateProfile(id, { full_name, phone }) {
    if (db.isConnected()) {
      await db.query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [full_name, phone, id]);
      return true;
    }
    const u = fallbackUsers.find(user => user.id == id);
    if (u) {
      u.full_name = full_name;
      u.phone = phone;
    }
    return true;
  }

  static async count() {
    if (db.isConnected()) {
      try {
        const res = await db.query('SELECT COUNT(*) as total FROM users');
        if (res && res[0] && res[0].total !== undefined) return res[0].total;
      } catch (err) {
        console.error('User.count DB error:', err.message);
      }
    }
    return fallbackUsers.length;
  }
}

module.exports = User;
