const Cart = require('../models/Cart');
const Coupon = require('../models/Coupon');
const Design = require('../models/Design');
const DesignVariant = require('../models/DesignVariant');
const Order = require('../models/Order');

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
    const { design_id, variant_id } = req.body;
    const userId = req.user ? req.user.id : null;

    const design = await Design.getById(design_id);
    if (!design) {
      if (req.xhr || req.headers.accept?.includes('json')) {
        return res.json({ success: false, message: 'Design not found' });
      }
      req.flash('error', 'Design not found.');
      return res.redirect('/shop');
    }

    const activeVariants = await DesignVariant.getByDesignId(design.id);
    let chosenVariant = null;

    if (activeVariants && activeVariants.length > 0) {
      if (!variant_id) {
        const errMsg = 'Please select a file / machine type before adding to cart.';
        if (req.xhr || req.headers.accept?.includes('json')) {
          return res.status(400).json({ success: false, message: errMsg });
        }
        req.flash('error', errMsg);
        return res.redirect(`/design/${design.slug}`);
      }

      chosenVariant = activeVariants.find(v => String(v.id) === String(variant_id));
      if (!chosenVariant) {
        const errMsg = 'Selected file / machine type is invalid or unavailable.';
        if (req.xhr || req.headers.accept?.includes('json')) {
          return res.status(400).json({ success: false, message: errMsg });
        }
        req.flash('error', errMsg);
        return res.redirect(`/design/${design.slug}`);
      }

      if (userId) {
        const alreadyBought = await Order.hasUserPurchasedVariant(userId, design.id, chosenVariant.id);
        if (alreadyBought) {
          const errMsg = 'You Have Already Purchased This Design. Please Select Some Other File.';
          if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(400).json({ success: false, message: errMsg });
          }
          req.flash('error', errMsg);
          return res.redirect(`/design/${design.slug}`);
        }
      }
    } else {
      if (userId) {
        const alreadyBought = await Order.hasUserPurchasedDesign(userId, design.id);
        if (alreadyBought) {
          const errMsg = 'You have already purchased this design.';
          if (req.xhr || req.headers.accept?.includes('json')) {
            return res.status(400).json({ success: false, message: errMsg });
          }
          req.flash('info', errMsg);
          return res.redirect(`/design/${design.slug}`);
        }
      }
    }

    await Cart.addItem(userId, req.session.cartSessionId, design_id, chosenVariant ? chosenVariant.id : null);

    const displayName = chosenVariant ? `${design.title} (${chosenVariant.variant_name})` : design.title;

    if (req.xhr || req.headers.accept?.includes('json')) {
      const updatedCart = await Cart.getCart(userId, req.session.cartSessionId);
      return res.json({
        success: true,
        message: `"${displayName}" added to your cart!`,
        cartCount: updatedCart.count
      });
    }

    req.flash('success', `"${displayName}" has been added to your cart.`);
    res.redirect('/cart');
  } catch (err) {
    next(err);
  }
};

exports.buyNow = async (req, res, next) => {
  try {
    const design_id = (req.body && req.body.design_id) || (req.query && req.query.design_id);
    const variant_id = (req.body && req.body.variant_id) || (req.query && req.query.variant_id);
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

    const activeVariants = await DesignVariant.getByDesignId(design.id);
    let chosenVariant = null;

    if (activeVariants && activeVariants.length > 0) {
      if (!variant_id) {
        req.flash('error', 'Please select a file / machine type before proceeding.');
        return res.redirect(`/design/${design.slug}`);
      }

      chosenVariant = activeVariants.find(v => String(v.id) === String(variant_id));
      if (!chosenVariant) {
        req.flash('error', 'Selected file / machine type is invalid or unavailable.');
        return res.redirect(`/design/${design.slug}`);
      }

      if (userId) {
        const alreadyBought = await Order.hasUserPurchasedVariant(userId, design.id, chosenVariant.id);
        if (alreadyBought) {
          req.flash('error', 'You Have Already Purchased This Design. Please Select Some Other File.');
          return res.redirect(`/design/${design.slug}`);
        }
      }
    } else {
      if (userId) {
        const alreadyBought = await Order.hasUserPurchasedDesign(userId, design.id);
        if (alreadyBought) {
          req.flash('info', 'You have already purchased this design.');
          return res.redirect(`/design/${design.slug}`);
        }
      }
    }

    if (req.session && !req.session.cartSessionId) {
      req.session.cartSessionId = 'sess_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
    }

    await Cart.addItem(userId, req.session ? req.session.cartSessionId : null, design_id, chosenVariant ? chosenVariant.id : null);
    res.redirect('/checkout');
  } catch (err) {
    console.error('[Buy Now Error]:', err.message || err);
    next(err);
  }
};

exports.removeFromCart = async (req, res, next) => {
  try {
    const { design_id, variant_id } = req.body;
    const userId = req.user ? req.user.id : null;

    await Cart.removeItem(userId, req.session.cartSessionId, design_id, variant_id || null);

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
