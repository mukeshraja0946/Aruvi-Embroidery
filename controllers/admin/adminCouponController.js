const Coupon = require('../../models/Coupon');

exports.getCoupons = async (req, res, next) => {
  try {
    const coupons = await Coupon.getAll();
    res.render('admin/coupons/index', {
      title: 'Manage Coupons & Discounts - Admin',
      coupons
    });
  } catch (err) {
    next(err);
  }
};

exports.postCreate = async (req, res, next) => {
  try {
    const { code, discount_type, discount_value, min_purchase, expiry_date, usage_limit, is_active } = req.body;

    await Coupon.create({
      code,
      discount_type,
      discount_value,
      min_purchase: min_purchase || 0,
      expiry_date: expiry_date || null,
      usage_limit: usage_limit || null,
      is_active: is_active ? 1 : 0
    });

    req.flash('success', `Coupon "${code.toUpperCase()}" created successfully.`);
    res.redirect('/admin/coupons');
  } catch (err) {
    next(err);
  }
};

exports.deleteCoupon = async (req, res, next) => {
  try {
    const { id } = req.params;
    await Coupon.delete(id);
    req.flash('info', 'Coupon removed.');
    res.redirect('/admin/coupons');
  } catch (err) {
    next(err);
  }
};
