const db = require('../config/db');

const fallbackWishlists = new Map(); // key: userId -> array of designIds

class Wishlist {
  static async getByUser(userId) {
    if (db.isConnected()) {
      const sql = `
        SELECT w.id as wishlist_id, d.*, c.name as category_name,
               (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
        FROM wishlist w
        JOIN designs d ON w.design_id = d.id
        LEFT JOIN categories c ON d.category_id = c.id
        WHERE w.user_id = ?
        ORDER BY w.created_at DESC
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
