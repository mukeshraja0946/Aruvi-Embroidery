const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const Design = require('../models/Design');

exports.getCart = async (req, res, next) => {
  try {
    const userId = req.user ? req.user.id : null;
    const cart = await Cart.getCart(userId, req.session.cartSessionId);

    let couponDiscount = 0;
    let appliedCoupon = req.session.appliedCoupon || null;

    if (appliedCoupon && cart.subtotal > 0) {
      const val = await Coupon.validate(appliedCoupon.code, cart.subtotal);
      if (val.valid) {
        couponDiscount = val.discountAmount;
      } else {
        delete req.session.appliedCoupon;
        appliedCoupon = null;
      }
    }

    const finalTotal = Math.max(0, cart.subtotal - couponDiscount);

    res.render('cart/index', {
      title: 'Shopping Cart - Aruvi Embroidery',
      cart,
      appliedCoupon,
      couponDiscount,
      finalTotal
    });
  } catch (err) {
    next(err);
  }
};

exports.addToCart = async (req, res, next) => {
  try {
    const { design_id } = req.body;
    const userId = req.user ? req.user.id : null;

    const design = await Design.getById(design_id);
    if (!design) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.json({ success: false, message: 'Design not found' });
      }
      req.flash('error', 'Design not found.');
      return res.redirect('/shop');
    }

    await Cart.addItem(userId, req.session.cartSessionId, design_id);

    if (req.xhr || req.headers.accept?.includes('json')) {
      const updatedCart = await Cart.getCart(userId, req.session.cartSessionId);
      return res.json({
        success: true,
        message: `"${design.title}" added to your cart!`,
        cartCount: updatedCart.count
      });
    }

    req.flash('success', `"${design.title}" has been added to your cart.`);
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.buyNow = async (req, res, next) => {
  try {
    const design_id = (req.body && req.body.design_id) || (req.query && req.query.design_id);
    const userId = req.user ? req.user.id : null;

    if (!design_id) {
      req.flash('error', 'Please select a design to purchase.');
      return res.redirect('/designs');
    }

    const design = await Design.getById(design_id);
    if (!design) {
      req.flash('error', 'Design not found.');
      return res.redirect('/designs');
    }

    if (req.session && !req.session.cartSessionId) {
      req.session.cartSessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    await Cart.addItem(userId, req.session ? req.session.cartSessionId : null, design_id);
    res.redirect('/checkout');
  } catch (err) {
    console.error('[Buy Now Error]:', err.message || err);
    next(err);
  }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const { design_id } = req.body;
    const userId = req.user ? req.user.id : null;

    await Cart.removeItem(userId, req.session.cartSessionId, design_id);

    req.flash('info', 'Item removed from cart.');
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.applyCoupon = async (req, res, next) => {
  try {
    const { coupon_code } = req.body;
    if (!coupon_code) {
      req.flash('error', 'Please enter a coupon code.');
      return res.redirect('/cart');
    }

    const userId = req.user ? req.user.id : null;
    const cart = await Cart.getCart(userId, req.session.cartSessionId);

    const validation = await Coupon.validate(coupon_code, cart.subtotal);
    if (!validation.valid) {
      req.flash('error', validation.message);
      return res.redirect('/cart');
    }

    req.session.appliedCoupon = {
      code: validation.code,
      discountAmount: validation.discountAmount,
      discountType: validation.discount_type
    };

    req.flash('success', `Coupon "${validation.code}" applied successfully! You saved ₹${validation.discountAmount}.`);
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.removeCoupon = (req, res) => {
  delete req.session.appliedCoupon;
  req.flash('info', 'Coupon removed.');
  res.redirect('/cart');
};
