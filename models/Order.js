const db = require('../config/db');

const fallbackOrders = [
  {
    id: 1,
    order_number: 'AE-20261001-9812',
    user_id: 2,
    guest_email: null,
    guest_name: 'Priya Lakshmi',
    guest_phone: '+91 91234 56789',
    total_amount: 499.00,
    discount_amount: 50.00,
    final_amount: 449.00,
    coupon_code: 'ARUVIFLAT50',
    status: 'completed',
    razorpay_order_id: 'order_test_981234',
    razorpay_payment_id: 'pay_test_981234',
    created_at: new Date('2026-10-01T10:00:00Z'),
    items: [
      {
        id: 1,
        order_id: 1,
        design_id: 1,
        title: 'Royal Bridal Peacock Neckline & Sleeve Set',
        slug: 'royal-bridal-peacock-neckline-sleeve-set',
        price_at_purchase: 499.00,
        primary_image: '/public/images/logo.jpg',
        file_name: 'Royal_Bridal_Peacock_Set.zip',
        file_path: '/public/uploads/designs/sample_peacock.zip'
      }
    ]
  }
];

class Order {
  static async createOrder({
    userId = null,
    guestEmail = null,
    guestName = null,
    guestPhone = null,
    items = [],
    totalAmount,
    discountAmount = 0,
    finalAmount,
    couponCode = null,
    razorpayOrderId = null,
    cashfreeOrderId = null,
    paymentGateway = 'cashfree'
  }) {
    const orderNumber = 'AE-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + Math.floor(1000 + Math.random() * 9000);

    if (db.isConnected()) {
      const orderRes = await db.query(
        `INSERT INTO orders (order_number, user_id, guest_email, guest_name, guest_phone, total_amount, discount_amount, final_amount, coupon_code, status, razorpay_order_id, cashfree_order_id, payment_gateway)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        [orderNumber, userId || null, guestEmail || null, guestName || null, guestPhone || null, totalAmount, discountAmount, finalAmount, couponCode || null, razorpayOrderId || null, cashfreeOrderId || null, paymentGateway]
      );
      const orderId = orderRes.insertId;

      for (const item of items) {
        await db.query(
          'INSERT INTO order_items (order_id, design_id, price_at_purchase) VALUES (?, ?, ?)',
          [orderId, item.design_id, item.effective_price]
        );
      }

      return { orderId, orderNumber };
    }

    const orderId = fallbackOrders.length + 1;
    const newOrder = {
      id: orderId,
      order_number: orderNumber,
      user_id: userId,
      guest_email: guestEmail,
      guest_name: guestName,
      guest_phone: guestPhone,
      total_amount: totalAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      coupon_code: couponCode,
      status: 'pending',
      razorpay_order_id: razorpayOrderId,
      created_at: new Date(),
      items: items.map((item, idx) => ({
        id: idx + 1,
        order_id: orderId,
        design_id: item.design_id,
        title: item.title,
        slug: item.slug,
        price_at_purchase: item.effective_price,
        primary_image: item.primary_image || '/public/images/logo.jpg',
        file_name: `Design_${item.design_id}.zip`,
        file_path: `/public/uploads/designs/sample_peacock.zip`
      }))
    };
    fallbackOrders.push(newOrder);
    return { orderId, orderNumber };
  }

  static async getById(id) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM orders WHERE id = ? LIMIT 1', [id]);
      if (!rows[0]) return null;

      const order = rows[0];
      const itemsSql = `
        SELECT oi.*, d.title, d.slug, d.hoop_size, d.formats,
               (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
        FROM order_items oi
        JOIN designs d ON oi.design_id = d.id
        WHERE oi.order_id = ?
      `;
      order.items = await db.query(itemsSql, [order.id]);
      return order;
    }
    return fallbackOrders.find(o => o.id == id) || null;
  }

  static async getByOrderNumber(orderNumber) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM orders WHERE order_number = ? LIMIT 1', [orderNumber]);
      if (!rows[0]) return null;
      return await this.getById(rows[0].id);
    }
    return fallbackOrders.find(o => o.order_number === orderNumber) || null;
  }

  static async getByUser(userId) {
    if (db.isConnected()) {
      const orders = await db.query('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [userId]);
      for (const order of orders) {
        order.items = await db.query(
          `SELECT oi.*, d.title, d.slug,
                  (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id ASC LIMIT 1) as primary_image
           FROM order_items oi
           JOIN designs d ON oi.design_id = d.id
           WHERE oi.order_id = ?`,
          [order.id]
        );
      }
      return orders;
    }
    return fallbackOrders.filter(o => o.user_id == userId);
  }

  static async getAll({ page = 1, limit = 20, status = null } = {}) {
    if (db.isConnected()) {
      let whereClause = status ? 'WHERE status = ?' : '';
      let params = status ? [status] : [];
      const offset = (page - 1) * limit;

      const sql = `SELECT o.*, u.full_name as user_name, u.email as user_email FROM orders o LEFT JOIN users u ON o.user_id = u.id ${whereClause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
      const orders = await db.query(sql, [...params, parseInt(limit), parseInt(offset)]);

      const countRes = await db.query(`SELECT COUNT(*) as total FROM orders ${whereClause}`, params);
      return { orders, total: countRes[0].total };
    }
    return { orders: fallbackOrders, total: fallbackOrders.length };
  }

  static async getByCashfreeOrderId(cfOrderId) {
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM orders WHERE cashfree_order_id = ? OR razorpay_order_id = ? LIMIT 1', [cfOrderId, cfOrderId]);
      if (!rows[0]) return null;
      return await this.getById(rows[0].id);
    }
    return fallbackOrders.find(o => o.cashfree_order_id === cfOrderId || o.razorpay_order_id === cfOrderId) || null;
  }

  static async updateCashfreeOrder(id, status, cashfreePaymentId = null, cashfreeOrderId = null) {
    if (db.isConnected()) {
      await db.query(
        'UPDATE orders SET status = ?, cashfree_payment_id = COALESCE(?, cashfree_payment_id), cashfree_order_id = COALESCE(?, cashfree_order_id), payment_gateway = "cashfree" WHERE id = ?',
        [status, cashfreePaymentId, cashfreeOrderId, id]
      );
      if (status === 'completed' || status === 'paid') {
        await db.query(`
          UPDATE designs d
          JOIN order_items oi ON d.id = oi.design_id
          SET d.total_sales = d.total_sales + 1
          WHERE oi.order_id = ?
        `, [id]);
      }
      return true;
    }

    const order = fallbackOrders.find(o => o.id == id);
    if (order) {
      order.status = status;
      if (cashfreePaymentId) order.cashfree_payment_id = cashfreePaymentId;
      if (cashfreeOrderId) order.cashfree_order_id = cashfreeOrderId;
      order.payment_gateway = 'cashfree';
    }
    return true;
  }

  static async updateStatus(id, status, razorpayPaymentId = null) {
    if (db.isConnected()) {
      await db.query(
        'UPDATE orders SET status = ?, razorpay_payment_id = COALESCE(?, razorpay_payment_id) WHERE id = ?',
        [status, razorpayPaymentId, id]
      );
      if (status === 'completed' || status === 'paid') {
        // Increment sales counts
        await db.query(`
          UPDATE designs d
          JOIN order_items oi ON d.id = oi.design_id
          SET d.total_sales = d.total_sales + 1
          WHERE oi.order_id = ?
        `, [id]);
      }
      return true;
    }

    const order = fallbackOrders.find(o => o.id == id);
    if (order) {
      order.status = status;
      if (razorpayPaymentId) order.razorpay_payment_id = razorpayPaymentId;
    }
    return true;
  }

  static async getPurchasedDesignsByUser(userId) {
    if (db.isConnected()) {
      const sql = `
        SELECT d.id as design_id, d.title, d.slug, d.hoop_size, d.formats,
               MAX(oi.price_at_purchase) as price_at_purchase,
               MAX(o.created_at) as purchase_date,
               MAX(o.order_number) as order_number,
               MIN(oi.id) as order_item_id,
               COALESCE(
                 (SELECT file_path FROM design_files WHERE design_id = d.id AND is_preview = 1 ORDER BY id DESC LIMIT 1),
                 (SELECT image_url FROM design_images WHERE design_id = d.id AND is_primary = 1 ORDER BY id DESC LIMIT 1),
                 (SELECT file_path FROM design_files WHERE design_id = d.id AND file_format IN ('PNG','JPG','JPEG','WEBP') ORDER BY id DESC LIMIT 1),
                 (SELECT image_url FROM design_images WHERE design_id = d.id ORDER BY is_primary DESC, id DESC LIMIT 1)
               ) as primary_image,
               (SELECT COUNT(*) FROM design_files WHERE design_id = d.id AND is_preview = 0 AND UPPER(file_format) IN ('DST','PES','JEF','EXP')) as file_count
        FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        JOIN designs d ON oi.design_id = d.id
        WHERE o.user_id = ? AND (o.status = 'completed' OR LOWER(o.status) = 'paid')
        GROUP BY d.id, d.title, d.slug, d.hoop_size, d.formats
        ORDER BY purchase_date DESC
      `;
      return await db.query(sql, [userId]);
    }
    return [
      {
        design_id: 1,
        title: 'AED 3',
        slug: 'rose-floral-design',
        hoop_size: '6x6 inch (150x150 mm)',
        formats: 'DST',
        purchase_date: new Date(),
        order_number: 'AE-20261005-5194',
        order_item_id: 1,
        primary_image: '/public/images/cat_floral.jpg',
        file_count: 1
      }
    ];
  }

  static async getPurchasedDesignIdsByUser(userId) {
    if (!userId) return [];
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT DISTINCT oi.design_id
          FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          WHERE o.user_id = ? AND (o.status = 'completed' OR LOWER(o.status) = 'paid')
        `;
        const rows = await db.query(sql, [userId]);
        return rows ? rows.map(r => r.design_id) : [];
      } catch (err) {
        console.error('getPurchasedDesignIdsByUser error:', err.message);
      }
    }
    const userOrders = fallbackOrders.filter(o => o.user_id == userId && (o.status === 'completed' || o.status === 'paid'));
    const ids = [];
    userOrders.forEach(o => {
      if (o.items) o.items.forEach(i => ids.push(i.design_id));
    });
    return [...new Set(ids)];
  }

  static async hasUserPurchasedDesign(userId, designId) {
    if (!userId || !designId) return false;
    if (db.isConnected()) {
      try {
        const sql = `
          SELECT 1 FROM orders o
          JOIN order_items oi ON o.id = oi.order_id
          WHERE o.user_id = ? AND oi.design_id = ? AND (o.status = 'completed' OR LOWER(o.status) = 'paid')
          LIMIT 1
        `;
        const rows = await db.query(sql, [userId, designId]);
        return !!(rows && rows.length > 0);
      } catch (err) {
        console.error('hasUserPurchasedDesign error:', err.message);
      }
    }
    const userOrders = fallbackOrders.filter(o => o.user_id == userId && (o.status === 'completed' || o.status === 'paid'));
    return userOrders.some(o => o.items && o.items.some(i => i.design_id == designId));
  }

  static async getStats() {
    if (db.isConnected()) {
      try {
        const totalSalesRes = await db.query("SELECT COALESCE(SUM(final_amount), 0) as total FROM orders WHERE status = 'completed'");
        const totalOrdersRes = await db.query("SELECT COUNT(*) as total FROM orders");
        const pendingOrdersRes = await db.query("SELECT COUNT(*) as total FROM orders WHERE status = 'pending'");
        const recentOrders = await db.query("SELECT o.*, COALESCE(u.full_name, o.guest_name) as customer_name FROM orders o LEFT JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 5");

        if (totalSalesRes && totalOrdersRes && pendingOrdersRes && recentOrders) {
          return {
            totalSales: (totalSalesRes[0] && totalSalesRes[0].total !== undefined) ? totalSalesRes[0].total : 0,
            totalOrders: (totalOrdersRes[0] && totalOrdersRes[0].total !== undefined) ? totalOrdersRes[0].total : 0,
            pendingOrders: (pendingOrdersRes[0] && pendingOrdersRes[0].total !== undefined) ? pendingOrdersRes[0].total : 0,
            recentOrders
          };
        }
      } catch (err) {
        console.error('Order.getStats DB error:', err.message);
      }
    }

    return {
      totalSales: 18450.00,
      totalOrders: 28,
      pendingOrders: 2,
      recentOrders: fallbackOrders
    };
  }
}

module.exports = Order;
