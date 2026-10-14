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

      const sql = `
        SELECT w.id as wishlist_id, d.*, c.name as category_name,
               (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
        FROM wishlist w
        JOIN designs d ON w.design_id = d.id
        LEFT JOIN categories c ON d.category_id = c.id
        WHERE w.user_id = ?
        ${orderBy}
      `;
      return await db.query(sql, [userId]);
    }
    const Design = require('./Design');
    const ids = fallbackWishlists.get(userId) || [];
    const result = [];
    for (const id of ids) {
      const d = await Design.getById(id);
      if (d) result.push({ wishlist_id: id, ...d });
    }
    return result;
  }

  static async add(userId, designId) {
    if (db.isConnected()) {
      await db.query('INSERT IGNORE INTO wishlist (user_id, design_id) VALUES (?, ?)', [userId, designId]);
      return true;
    }
    const ids = fallbackWishlists.get(userId) || [];
    if (!ids.includes(parseInt(designId))) {
      ids.push(parseInt(designId));
      fallbackWishlists.set(userId, ids);
    }
    return true;
  }

  static async remove(userId, designId) {
    if (db.isConnected()) {
      await db.query('DELETE FROM wishlist WHERE user_id = ? AND design_id = ?', [userId, designId]);
      return true;
    }
    let ids = fallbackWishlists.get(userId) || [];
    ids = ids.filter(id => id != designId);
    fallbackWishlists.set(userId, ids);
    return true;
  }

  static async isInWishlist(userId, designId) {
    if (!userId) return false;
    if (db.isConnected()) {
      const rows = await db.query('SELECT id FROM wishlist WHERE user_id = ? AND design_id = ? LIMIT 1', [userId, designId]);
      return rows.length > 0;
    }
    const ids = fallbackWishlists.get(userId) || [];
    return ids.includes(parseInt(designId));
  }
}

module.exports = Wishlist;
