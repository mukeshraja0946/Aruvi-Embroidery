const db = require('../config/db');

const fallbackWishlists = new Map(); // key: userId -> array of designIds

class Wishlist {
  static async getByUser(userId, sort = 'latest') {
    if (db.isConnected()) {
      let orderBy = 'ORDER BY w.created_at DESC';
      if (sort === 'price_asc' || sort === 'price_low') {
        orderBy = 'ORDER BY COALESCE(d.sale_price, d.price) ASC, d.id ASC';
      } else if (sort === 'price_desc' || sort === 'price_high') {
        orderBy = 'ORDER BY COALESCE(d.sale_price, d.price) DESC, d.id DESC';
      } else if (sort === 'popular') {
        orderBy = 'ORDER BY (COALESCE(d.total_sales, 0) + COALESCE(d.download_count, 0)) DESC, d.id DESC';
      } else if (sort === 'top_rated') {
        orderBy = 'ORDER BY d.average_rating DESC, d.id DESC';
      } else {
        orderBy = 'ORDER BY w.created_at DESC';
      }

      try {
        const sql = `
          SELECT w.id as wishlist_id, d.*, c.name as category_name,
                 (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
          FROM wishlist w
          JOIN designs d ON w.design_id = d.id
          LEFT JOIN categories c ON d.category_id = c.id
          WHERE w.user_id = ? AND (d.is_active = 1 OR d.is_active IS NULL)
          ${orderBy}
        `;
        return await db.query(sql, [userId]);
      } catch (err) {
        console.error('Wishlist.getByUser DB error:', err.message);
        return [];
      }
    }
    const Design = require('./Design');
    const ids = fallbackWishlists.get(userId) || [];
    const result = [];
    for (const id of ids) {
      const d = await Design.getById(id);
      if (d && (d.is_active === 1 || d.is_active === undefined)) {
        result.push({ wishlist_id: id, ...d });
      }
    }
    return result;
  }

  static async countInactive(userId) {
    if (!userId) return 0;
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT COUNT(*) as cnt
          FROM wishlist w
          LEFT JOIN designs d ON w.design_id = d.id
          WHERE w.user_id = ? AND (d.id IS NULL OR d.is_active = 0)
        `;
        const rows = await db.query(sql, [userId]);
        return rows && rows[0] ? parseInt(rows[0].cnt || 0, 10) : 0;
      } catch (err) {
        return 0;
      }
    }
    return 0;
  }

  static async add(userId, designId) {
    if (!userId || !designId) return false;
    if (db.isConnected()) {
      try {
        await db.query('INSERT IGNORE INTO wishlist (user_id, design_id) VALUES (?, ?)', [userId, designId]);
        return true;
      } catch (err) {
        console.error('Wishlist.add DB error:', err.message);
        return false;
      }
    }
    const ids = fallbackWishlists.get(userId) || [];
    if (!ids.includes(parseInt(designId, 10))) {
      ids.push(parseInt(designId, 10));
      fallbackWishlists.set(userId, ids);
    }
    return true;
  }

  static async remove(userId, designId) {
    if (!userId || !designId) return false;
    if (db.isConnected()) {
      try {
        await db.query('DELETE FROM wishlist WHERE user_id = ? AND design_id = ?', [userId, designId]);
        return true;
      } catch (err) {
        console.error('Wishlist.remove DB error:', err.message);
        return false;
      }
    }
    let ids = fallbackWishlists.get(userId) || [];
    ids = ids.filter(id => id != designId);
    fallbackWishlists.set(userId, ids);
    return true;
  }

  static async isInWishlist(userId, designId) {
    if (!userId || !designId) return false;
    if (db.isConnected()) {
      try {
        const rows = await db.query('SELECT id FROM wishlist WHERE user_id = ? AND design_id = ? LIMIT 1', [userId, designId]);
        return rows && rows.length > 0;
      } catch (err) {
        console.error('Wishlist.isInWishlist DB error:', err.message);
        return false;
      }
    }
    const ids = fallbackWishlists.get(userId) || [];
    return ids.includes(parseInt(designId, 10));
  }

  static async getCount(userId) {
    if (!userId) return 0;
    if (db.isConnected()) {
      try {
        const rows = await db.query(`
          SELECT COUNT(*) as cnt 
          FROM wishlist w 
          JOIN designs d ON w.design_id = d.id 
          WHERE w.user_id = ? AND (d.is_active = 1 OR d.is_active IS NULL)
        `, [userId]);
        return rows && rows[0] ? parseInt(rows[0].cnt || 0, 10) : 0;
      } catch (err) {
        console.error('Wishlist.getCount DB error:', err.message);
        return 0;
      }
    }
    const ids = fallbackWishlists.get(userId) || [];
    return ids.length;
  }

  static async mergeWishlist(userId, designIds = []) {
    if (!userId || !Array.isArray(designIds) || designIds.length === 0) return 0;
    let count = 0;
    for (const rawId of designIds) {
      const dId = parseInt(rawId, 10);
      if (!isNaN(dId) && dId > 0) {
        const added = await this.add(userId, dId);
        if (added) count++;
      }
    }
    return count;
  }
}

module.exports = Wishlist;
