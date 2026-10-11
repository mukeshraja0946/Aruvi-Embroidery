const db = require('../config/db');

// Empty fallback store for offline database mode (no fake reviews)
const fallbackReviews = [];

class Review {
  static async getByDesignId(designId) {
    if (db.isConnected()) {
      const sql = `
        SELECT r.*, u.full_name as user_name
        FROM reviews r
        JOIN users u ON r.user_id = u.id
        WHERE r.design_id = ? AND r.is_approved = 1
        ORDER BY r.created_at DESC
      `;
      return await db.query(sql, [designId]);
    }
    return fallbackReviews.filter(r => r.design_id == designId && r.is_approved);
  }

  static async addReview({ design_id, user_id, rating, comment }) {
    if (db.isConnected()) {
      const res = await db.query(
        'INSERT INTO reviews (design_id, user_id, rating, comment, is_approved) VALUES (?, ?, ?, ?, 1)',
        [design_id, user_id, rating, comment]
      );
      // Update design average rating and count
      const avgRes = await db.query('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE design_id = ? AND is_approved = 1', [design_id]);
      if (avgRes[0] && avgRes[0].avg_rating) {
        await db.query('UPDATE designs SET average_rating = ?, reviews_count = ? WHERE id = ?', [
          parseFloat(avgRes[0].avg_rating).toFixed(2),
          avgRes[0].count,
          design_id
        ]);
      }
      return res.insertId;
    }
    const newId = fallbackReviews.length + 1;
    const rev = { id: newId, design_id, user_id, user_name: 'Verified Customer', rating: parseInt(rating), comment, is_approved: 1, created_at: new Date() };
    fallbackReviews.push(rev);
    return newId;
  }

  static async getAll({ page = 1, limit = 15, status = null, search = null, sort = 'newest' } = {}) {
    if (db.isConnected()) {
      try {
        let whereClauses = [];
        let params = [];

        if (status === 'approved') {
          whereClauses.push('r.is_approved = 1');
        } else if (status === 'pending') {
          whereClauses.push('r.is_approved = 0');
        }

        if (search && search.trim()) {
          const q = `%${search.trim()}%`;
          whereClauses.push('(u.full_name LIKE ? OR d.title LIKE ? OR r.comment LIKE ?)');
          params.push(q, q, q);
        }

        const whereClause = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
        const offset = (page - 1) * limit;

        let orderSql = 'ORDER BY r.created_at DESC';
        if (sort === 'oldest') orderSql = 'ORDER BY r.created_at ASC';
        else if (sort === 'rating_high') orderSql = 'ORDER BY r.rating DESC, r.created_at DESC';
        else if (sort === 'rating_low') orderSql = 'ORDER BY r.rating ASC, r.created_at DESC';

        const sql = `
          SELECT r.*, u.full_name as user_name, u.email as user_email, d.title as design_title, d.slug as design_slug,
                 (SELECT di.image_url FROM design_images di WHERE di.design_id = d.id ORDER BY di.is_primary DESC, di.id ASC LIMIT 1) as design_image
          FROM reviews r
          JOIN users u ON r.user_id = u.id
          JOIN designs d ON r.design_id = d.id
          ${whereClause}
          ${orderSql}
          LIMIT ? OFFSET ?
        `;
        const reviews = await db.query(sql, [...params, parseInt(limit), parseInt(offset)]);
        const [countRow] = await db.query(`
          SELECT COUNT(*) as total
          FROM reviews r
          JOIN users u ON r.user_id = u.id
          JOIN designs d ON r.design_id = d.id
          ${whereClause}
        `, params);

        return {
          reviews: reviews || [],
          total: countRow ? countRow.total : 0
        };
      } catch (err) {
        console.error('Review.getAll DB error:', err.message);
      }
    }

    let list = [...fallbackReviews];
    if (status === 'approved') list = list.filter(r => r.is_approved === 1);
    else if (status === 'pending') list = list.filter(r => r.is_approved === 0);
    return { reviews: list, total: list.length };
  }

  static async toggleStatus(id) {
    if (db.isConnected()) {
      await db.query('UPDATE reviews SET is_approved = NOT is_approved WHERE id = ?', [id]);
      const [row] = await db.query('SELECT is_approved, design_id FROM reviews WHERE id = ?', [id]);
      if (row) {
        // Recalculate average rating for that design
        const [avgRes] = await db.query('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE design_id = ? AND is_approved = 1', [row.design_id]);
        const avg = avgRes && avgRes.avg_rating ? parseFloat(avgRes.avg_rating).toFixed(2) : 0.00;
        const count = avgRes ? avgRes.count : 0;
        await db.query('UPDATE designs SET average_rating = ?, reviews_count = ? WHERE id = ?', [avg, count, row.design_id]);
        return row.is_approved;
      }
      return false;
    }
    const r = fallbackReviews.find(x => x.id == id);
    if (r) {
      r.is_approved = r.is_approved ? 0 : 1;
      return r.is_approved;
    }
    return false;
  }

  static async delete(id) {
    if (db.isConnected()) {
      const [row] = await db.query('SELECT design_id FROM reviews WHERE id = ?', [id]);
      await db.query('DELETE FROM reviews WHERE id = ?', [id]);
      if (row) {
        const [avgRes] = await db.query('SELECT AVG(rating) as avg_rating, COUNT(*) as count FROM reviews WHERE design_id = ? AND is_approved = 1', [row.design_id]);
        const avg = avgRes && avgRes.avg_rating ? parseFloat(avgRes.avg_rating).toFixed(2) : 0.00;
        const count = avgRes ? avgRes.count : 0;
        await db.query('UPDATE designs SET average_rating = ?, reviews_count = ? WHERE id = ?', [avg, count, row.design_id]);
      }
      return true;
    }
    const idx = fallbackReviews.findIndex(r => r.id == id);
    if (idx !== -1) fallbackReviews.splice(idx, 1);
    return true;
  }

  static async count() {
    if (db.isConnected()) {
      const [res] = await db.query('SELECT COUNT(*) as total FROM reviews');
      return res ? res.total : 0;
    }
    return fallbackReviews.length;
  }
}

module.exports = Review;
