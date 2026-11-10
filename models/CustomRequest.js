const db = require('../config/db');

// Fallback in-memory store for offline development / test mode
const fallbackRequests = [];

class CustomRequest {
  /**
   * Generates a standard request number: CR-YYYYMMDD-XXXX
   */
  static generateRequestNumber(id = 1) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const seq = String(id).padStart(4, '0');
    return `CR-${y}${m}${d}-${seq}`;
  }

  /**
   * Check for duplicate submission within 60 seconds
   */
  static async findRecentDuplicate(email, description) {
    if (!email || !description) return null;
    const cleanEmail = email.trim().toLowerCase();
    const cleanDesc = description.trim();

    if (db.isConnected()) {
      try {
        const rows = await db.query(
          `SELECT * FROM custom_requests 
           WHERE LOWER(TRIM(email)) = ? 
             AND TRIM(description) = ? 
             AND created_at >= NOW() - INTERVAL 60 SECOND 
           LIMIT 1`,
          [cleanEmail, cleanDesc]
        );
        return (rows && rows[0]) ? rows[0] : null;
      } catch (err) {
        console.warn('[CustomRequest.findRecentDuplicate warning]:', err.message);
      }
    }

    const oneMinuteAgo = Date.now() - 60000;
    return fallbackRequests.find(r => 
      (r.email || '').toLowerCase() === cleanEmail &&
      (r.description || '').trim() === cleanDesc &&
      new Date(r.created_at).getTime() >= oneMinuteAgo
    ) || null;
  }

  /**
   * Creates a new custom request in a transaction (with request number generation)
   */
  static async create({
    userId = null,
    name,
    email,
    phone,
    design_title,
    description,
    category_id = null,
    preferred_formats = 'DST, PES, JEF, EXP',
    size_hoop = null,
    budget = null,
    deadline = null,
    reference_image_key = null,
    status = 'new',
    admin_notes = null,
    quoted_price = null
  }) {
    const cleanName = (name || '').trim();
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPhone = (phone || '').trim();
    const cleanTitle = (design_title || 'Custom Embroidery Request').trim();
    const cleanDesc = (description || '').trim();
    const cleanFormats = (preferred_formats || 'DST, PES, JEF, EXP').trim();
    const cleanSize = (size_hoop && String(size_hoop).trim() !== '') ? String(size_hoop).trim() : null;
    const parsedBudget = (budget !== null && budget !== '' && !isNaN(budget)) ? parseFloat(budget) : null;
    const parsedDeadline = (deadline && String(deadline).trim() !== '' && !isNaN(Date.parse(deadline))) ? String(deadline).trim() : null;
    const parsedCategoryId = (category_id && !isNaN(category_id)) ? parseInt(category_id, 10) : null;

    if (db.isConnected()) {
      let conn = null;
      try {
        if (typeof db.getConnection === 'function') {
          conn = await db.getConnection();
          await conn.beginTransaction();

          // 1. Insert temporary record to allocate autoincrement ID
          const tempReqNum = `TEMP-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const [insertRes] = await conn.query(
            `INSERT INTO custom_requests (
              request_number, user_id, name, email, phone, design_title, description,
              category_id, preferred_formats, size_hoop, budget, deadline,
              reference_image_key, status, admin_notes, quoted_price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tempReqNum,
              userId || null,
              cleanName,
              cleanEmail,
              cleanPhone,
              cleanTitle,
              cleanDesc,
              parsedCategoryId,
              cleanFormats,
              cleanSize,
              parsedBudget,
              parsedDeadline,
              reference_image_key || null,
              status || 'new',
              admin_notes || null,
              quoted_price || null
            ]
          );

          const newId = insertRes.insertId;
          const requestNumber = CustomRequest.generateRequestNumber(newId);

          // 2. Update with official formatted request number (e.g. CR-20261101-0001)
          await conn.query(
            'UPDATE custom_requests SET request_number = ? WHERE id = ?',
            [requestNumber, newId]
          );

          await conn.commit();

          return {
            id: newId,
            request_number: requestNumber,
            user_id: userId,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            design_title: cleanTitle,
            description: cleanDesc,
            preferred_formats: cleanFormats,
            size_hoop: cleanSize,
            budget: parsedBudget,
            deadline: parsedDeadline,
            reference_image_key,
            status: status || 'new'
          };
        } else {
          // Direct db.query execution fallback
          const tempReqNum = `TEMP-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const insertRes = await db.query(
            `INSERT INTO custom_requests (
              request_number, user_id, name, email, phone, design_title, description,
              category_id, preferred_formats, size_hoop, budget, deadline,
              reference_image_key, status, admin_notes, quoted_price
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tempReqNum,
              userId || null,
              cleanName,
              cleanEmail,
              cleanPhone,
              cleanTitle,
              cleanDesc,
              parsedCategoryId,
              cleanFormats,
              cleanSize,
              parsedBudget,
              parsedDeadline,
              reference_image_key || null,
              status || 'new',
              admin_notes || null,
              quoted_price || null
            ]
          );

          const newId = insertRes.insertId;
          const requestNumber = CustomRequest.generateRequestNumber(newId);

          await db.query(
            'UPDATE custom_requests SET request_number = ? WHERE id = ?',
            [requestNumber, newId]
          );

          return {
            id: newId,
            request_number: requestNumber,
            user_id: userId,
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            design_title: cleanTitle,
            description: cleanDesc,
            preferred_formats: cleanFormats,
            size_hoop: cleanSize,
            budget: parsedBudget,
            deadline: parsedDeadline,
            reference_image_key,
            status: status || 'new'
          };
        }
      } catch (err) {
        if (conn) {
          try { await conn.rollback(); } catch (_) {}
        }
        throw err;
      } finally {
        if (conn) {
          try { conn.release(); } catch (_) {}
        }
      }
    }

    // Fallback in-memory
    const newId = fallbackRequests.length + 1;
    const requestNumber = CustomRequest.generateRequestNumber(newId);
    const item = {
      id: newId,
      request_number: requestNumber,
      user_id: userId,
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      design_title: cleanTitle,
      description: cleanDesc,
      category_id: parsedCategoryId,
      preferred_formats: cleanFormats,
      size_hoop: cleanSize,
      budget: parsedBudget,
      deadline: parsedDeadline,
      reference_image_key,
      status: status || 'new',
      admin_notes: admin_notes || null,
      quoted_price: quoted_price || null,
      created_at: new Date(),
      updated_at: new Date()
    };
    fallbackRequests.push(item);
    return item;
  }

  /**
   * Get all custom requests with pagination, status filters, search, and sorting
   */
  static async getAll({ page = 1, limit = 15, status = null, search = null, sort = 'newest' } = {}) {
    if (db.isConnected()) {
      try {
        const whereClauses = [];
        const params = [];

        if (status && status !== 'all') {
          whereClauses.push('status = ?');
          params.push(status);
        }

        if (search && search.trim()) {
          const q = `%${search.trim()}%`;
          whereClauses.push('(request_number LIKE ? OR name LIKE ? OR email LIKE ? OR phone LIKE ? OR design_title LIKE ? OR description LIKE ?)');
          params.push(q, q, q, q, q, q);
        }

        const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        const orderSql = sort === 'oldest' ? 'ORDER BY created_at ASC, id ASC' : 'ORDER BY created_at DESC, id DESC';
        const offset = Math.max(0, (page - 1) * limit);

        const requests = await db.query(
          `SELECT * FROM custom_requests ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
          [...params, parseInt(limit), parseInt(offset)]
        );

        const countRes = await db.query(
          `SELECT COUNT(*) as total FROM custom_requests ${whereSql}`,
          params
        );

        const total = (countRes && countRes[0] && countRes[0].total !== undefined) ? countRes[0].total : (requests ? requests.length : 0);

        return { requests: requests || [], total };
      } catch (err) {
        console.error('CustomRequest.getAll error:', err.message);
      }
    }

    // Fallback filtering
    let list = [...fallbackRequests];
    if (status && status !== 'all') {
      list = list.filter(r => r.status === status);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(r =>
        (r.request_number && r.request_number.toLowerCase().includes(q)) ||
        (r.name && r.name.toLowerCase().includes(q)) ||
        (r.email && r.email.toLowerCase().includes(q)) ||
        (r.phone && r.phone.toLowerCase().includes(q)) ||
        (r.design_title && r.design_title.toLowerCase().includes(q)) ||
        (r.description && r.description.toLowerCase().includes(q))
      );
    }
    if (sort === 'oldest') {
      list.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    } else {
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    const offset = (page - 1) * limit;
    const paginated = list.slice(offset, offset + limit);
    return { requests: paginated, total: list.length };
  }

  /**
   * Get single request by ID
   */
  static async getById(id) {
    if (db.isConnected()) {
      try {
        const rows = await db.query('SELECT * FROM custom_requests WHERE id = ? LIMIT 1', [id]);
        return (rows && rows[0]) ? rows[0] : null;
      } catch (err) {
        console.error('CustomRequest.getById error:', err.message);
      }
    }
    return fallbackRequests.find(r => r.id == id) || null;
  }

  /**
   * Get single request by request number
   */
  static async getByRequestNumber(requestNumber) {
    if (db.isConnected()) {
      try {
        const rows = await db.query('SELECT * FROM custom_requests WHERE request_number = ? LIMIT 1', [requestNumber]);
        return (rows && rows[0]) ? rows[0] : null;
      } catch (err) {
        console.error('CustomRequest.getByRequestNumber error:', err.message);
      }
    }
    return fallbackRequests.find(r => r.request_number === requestNumber) || null;
  }

  /**
   * Get all requests for a user
   */
  static async getByUser(userId) {
    if (!userId) return [];
    if (db.isConnected()) {
      try {
        const rows = await db.query(
          'SELECT * FROM custom_requests WHERE user_id = ? ORDER BY created_at DESC',
          [userId]
        );
        return rows || [];
      } catch (err) {
        console.error('CustomRequest.getByUser error:', err.message);
      }
    }
    return fallbackRequests.filter(r => r.user_id == userId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  /**
   * Update request status and admin notes
   */
  static async updateStatus(id, status, admin_notes = null, quoted_price = null) {
    if (db.isConnected()) {
      const updates = ['status = ?'];
      const params = [status];

      if (admin_notes !== null) {
        updates.push('admin_notes = ?');
        params.push(admin_notes);
      }
      if (quoted_price !== null && quoted_price !== '') {
        updates.push('quoted_price = ?');
        params.push(parseFloat(quoted_price));
      }

      params.push(id);
      await db.query(`UPDATE custom_requests SET ${updates.join(', ')} WHERE id = ?`, params);
      return true;
    }

    const r = fallbackRequests.find(item => item.id == id);
    if (r) {
      r.status = status;
      if (admin_notes !== null) r.admin_notes = admin_notes;
      if (quoted_price !== null && quoted_price !== '') r.quoted_price = parseFloat(quoted_price);
      r.updated_at = new Date();
    }
    return true;
  }

  /**
   * Delete request
   */
  static async delete(id) {
    if (db.isConnected()) {
      await db.query('DELETE FROM custom_requests WHERE id = ?', [id]);
      return true;
    }
    const idx = fallbackRequests.findIndex(r => r.id == id);
    if (idx !== -1) fallbackRequests.splice(idx, 1);
    return true;
  }

  /**
   * Get statistics breakdown for admin dashboard
   */
  static async getStats() {
    const stats = {
      total: 0,
      new: 0,
      in_review: 0,
      quoted: 0,
      accepted: 0,
      completed: 0,
      rejected: 0,
      pending: 0
    };

    if (db.isConnected()) {
      try {
        const rows = await db.query(`
          SELECT status, COUNT(*) as count 
          FROM custom_requests 
          GROUP BY status
        `);

        if (rows && rows.length > 0) {
          rows.forEach(r => {
            const st = r.status;
            const c = Number(r.count || 0);
            stats.total += c;
            if (stats[st] !== undefined) {
              stats[st] = c;
            }
          });
          stats.pending = stats.new + stats.in_review;
        }
        return stats;
      } catch (err) {
        console.warn('[CustomRequest.getStats warning]:', err.message);
      }
    }

    fallbackRequests.forEach(r => {
      stats.total++;
      if (stats[r.status] !== undefined) stats[r.status]++;
    });
    stats.pending = stats.new + stats.in_review;
    return stats;
  }
}

module.exports = CustomRequest;
