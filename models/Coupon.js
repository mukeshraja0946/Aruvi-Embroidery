const db = require('../config/db');

const fallbackCoupons = [
  { id: 1, code: 'WELCOME10', discount_type: 'percentage', discount_value: 10.00, min_purchase: 199.00, expiry_date: '2026-12-31', usage_limit: 500, times_used: 12, is_active: 1 },
  { id: 2, code: 'ARUVIFLAT50', discount_type: 'fixed', discount_value: 50.00, min_purchase: 399.00, expiry_date: '2026-12-31', usage_limit: 200, times_used: 8, is_active: 1 },
  { id: 3, code: 'FESTIVE20', discount_type: 'percentage', discount_value: 20.00, min_purchase: 499.00, expiry_date: '2026-12-31', usage_limit: 100, times_used: 3, is_active: 1 }
];

class Coupon {
  static async validate(code, subtotal) {
    let coupon = null;
    if (db.isConnected()) {
      const rows = await db.query('SELECT * FROM coupons WHERE UPPER(code) = UPPER(?) AND is_active = 1 LIMIT 1', [code.trim()]);
      coupon = rows[0];
    } else {
      coupon = fallbackCoupons.find(c => c.code.toUpperCase() === code.trim().toUpperCase() && c.is_active);
    }

    if (!coupon) return { valid: false, message: 'Invalid or expired coupon code.' };

    if (coupon.expiry_date && new Date(coupon.expiry_date) < new Date()) {
      return { valid: false, message: 'Coupon code has expired.' };
    }

    if (coupon.min_purchase && subtotal < parseFloat(coupon.min_purchase)) {
      return { valid: false, message: `Minimum purchase of ₹${coupon.min_purchase} required for this coupon.` };
    }

    let discount = 0;
    if (coupon.discount_type === 'percentage') {
      discount = (subtotal * parseFloat(coupon.discount_value)) / 100;
    } else {
      discount = parseFloat(coupon.discount_value);
    }

    discount = Math.min(discount, subtotal);

    return {
      valid: true,
      code: coupon.code,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      discountAmount: parseFloat(discount.toFixed(2))
    };
  }

  static async getAll() {
    if (db.isConnected()) {
      return await db.query('SELECT * FROM coupons ORDER BY created_at DESC');
    }
    return fallbackCoupons;
  }

  static async create({ code, discount_type, discount_value, min_purchase = 0, expiry_date = null, usage_limit = null, is_active = 1 }) {
    if (db.isConnected()) {
      const res = await db.query(
        'INSERT INTO coupons (code, discount_type, discount_value, min_purchase, expiry_date, usage_limit, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [code.toUpperCase(), discount_type, discount_value, min_purchase, expiry_date, usage_limit, is_active]
      );
      return res.insertId;
    }
    const newId = fallbackCoupons.length + 1;
    const c = { id: newId, code: code.toUpperCase(), discount_type, discount_value, min_purchase, expiry_date, usage_limit, times_used: 0, is_active };
    fallbackCoupons.push(c);
    return newId;
  }

  static async delete(id) {
    if (db.isConnected()) {
      await db.query('DELETE FROM coupons WHERE id = ?', [id]);
      return true;
    }
    const idx = fallbackCoupons.findIndex(c => c.id == id);
    if (idx !== -1) fallbackCoupons.splice(idx, 1);
    return true;
  }
}

module.exports = Coupon;
