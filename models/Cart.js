const db = require('../config/db');
const Design = require('./Design');

const fallbackCarts = new Map(); // key: userId or sessionId

class Cart {
  static async getCart(userId, sessionId) {
    if (db.isConnected()) {
      try {
        let sql, params;
        if (userId) {
          sql = `
            SELECT ci.id as cart_item_id, ci.design_id, ci.created_at,
                   d.title, d.slug, d.price, d.sale_price, d.hoop_size, d.formats,
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
            FROM cart_items ci
            JOIN designs d ON ci.design_id = d.id
            WHERE ci.user_id = ?
          `;
          params = [userId];
        } else {
          sql = `
            SELECT ci.id as cart_item_id, ci.design_id, ci.created_at,
                   d.title, d.slug, d.price, d.sale_price, d.hoop_size, d.formats,
                   (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
            FROM cart_items ci
            JOIN designs d ON ci.design_id = d.id
            WHERE ci.session_id = ?
          `;
          params = [sessionId];
        }
        const items = await db.query(sql, params);
        if (Array.isArray(items)) {
          return this.calculateTotals(items);
        }
      } catch (err) {
        console.warn('[Cart getCart Error]:', err.message);
      }
    }

    const key = userId ? `user_${userId}` : `sess_${sessionId}`;
    let designIds = fallbackCarts.get(key);
    if (!designIds) {
      designIds = [];
      fallbackCarts.set(key, designIds);
    }
    const items = [];
    for (const dId of designIds) {
      const design = await Design.getById(dId);
      if (design) {
        items.push({
          cart_item_id: dId,
          design_id: design.id,
          title: design.title,
          slug: design.slug,
          price: design.price,
          sale_price: design.sale_price,
          hoop_size: design.hoop_size,
          formats: design.formats,
          primary_image: design.primary_image || '/public/images/logo.jpg'
        });
      }
    }
    return this.calculateTotals(items);
  }

  static calculateTotals(items = []) {
    const safeItems = Array.isArray(items) ? items : [];
    let subtotal = 0;
    let originalTotal = 0;
    const formattedItems = safeItems.map(item => {
      const origPrice = parseFloat(item.price || 0);
      const currentPrice = (item.sale_price !== null && item.sale_price !== undefined && item.sale_price !== '')
        ? parseFloat(item.sale_price)
        : origPrice;
      originalTotal += origPrice;
      subtotal += currentPrice;
      return {
        ...item,
        price: origPrice,
        sale_price: currentPrice < origPrice ? currentPrice : null,
        effective_price: currentPrice,
        primary_image: item.primary_image || '/public/images/logo.jpg'
      };
    });

    const itemDiscount = Math.max(0, originalTotal - subtotal);

    return {
      items: formattedItems,
      count: formattedItems.length,
      originalTotal: parseFloat(originalTotal.toFixed(2)),
      subtotal: parseFloat(subtotal.toFixed(2)),
      totalDiscount: parseFloat(itemDiscount.toFixed(2))
    };
  }

  static async addItem(userId, sessionId, designId) {
    if (!designId) return false;
    if (db.isConnected()) {
      try {
        let checkSql = userId ? 'SELECT id FROM cart_items WHERE user_id = ? AND design_id = ?' : 'SELECT id FROM cart_items WHERE session_id = ? AND design_id = ?';
        let checkParams = userId ? [userId, designId] : [sessionId, designId];
        const existing = await db.query(checkSql, checkParams);

        if (Array.isArray(existing) && existing.length === 0) {
          const insertSql = 'INSERT INTO cart_items (user_id, session_id, design_id) VALUES (?, ?, ?)';
          await db.query(insertSql, [userId || null, userId ? null : sessionId, designId]);
        }
        return true;
      } catch (err) {
        console.warn('[Cart addItem DB Warning]:', err.message);
      }
    }

    const key = userId ? `user_${userId}` : `sess_${sessionId}`;
    const list = fallbackCarts.get(key) || [];
    if (!list.includes(parseInt(designId))) {
      list.push(parseInt(designId));
      fallbackCarts.set(key, list);
    }
    return true;
  }

  static async removeItem(userId, sessionId, designId) {
    if (db.isConnected()) {
      try {
        let deleteSql = userId ? 'DELETE FROM cart_items WHERE user_id = ? AND design_id = ?' : 'DELETE FROM cart_items WHERE session_id = ? AND design_id = ?';
        let deleteParams = userId ? [userId, designId] : [sessionId, designId];
        await db.query(deleteSql, deleteParams);
        return true;
      } catch (err) {
        console.warn('[Cart removeItem DB Warning]:', err.message);
      }
    }

    const key = userId ? `user_${userId}` : `sess_${sessionId}`;
    let list = fallbackCarts.get(key) || [];
    list = list.filter(id => id != designId);
    fallbackCarts.set(key, list);
    return true;
  }

  static async clearCart(userId, sessionId) {
    if (db.isConnected()) {
      try {
        let sql = userId ? 'DELETE FROM cart_items WHERE user_id = ?' : 'DELETE FROM cart_items WHERE session_id = ?';
        let params = userId ? [userId] : [sessionId];
        await db.query(sql, params);
        return true;
      } catch (err) {
        console.warn('[Cart clearCart DB Warning]:', err.message);
      }
    }

    const key = userId ? `user_${userId}` : `sess_${sessionId}`;
    fallbackCarts.delete(key);
    return true;
  }
}

module.exports = Cart;
