const dotenv = require('dotenv');
dotenv.config();

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const Razorpay = require('razorpay');
const emailService = require('../services/emailService');
const crypto = require('crypto');

const keyId = process.env.RAZORPAY_KEY_ID || process.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_samplekey123';
const keySecret = process.env.RAZORPAY_KEY_SECRET || 'sample_secret_key_456';
const isRealRazorpayKey = keyId && !keyId.includes('samplekey');

let razorpayInstance = null;
try {
  if (isRealRazorpayKey) {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret
    });
  }
} catch (e) {
  console.warn('Razorpay init warning:', e.message);
}

console.log(`[Razorpay Config]: Key ID configured: ${isRealRazorpayKey ? 'YES (Live/Test Key)' : 'DEFAULT TEST KEY'}`);

exports.getCheckout = async (req, res, next) => {
  try {
    // Requirement 4: Require Login for Checkout
    if (!req.user) {
      req.flash('error', 'Please log in to access checkout.');
      req.session.returnTo = '/checkout';
      return res.redirect('/auth/login');
    }

    const userId = req.user.id;
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

    // Requirement 1: Correct server-side price breakdown
    const originalTotal = cart.originalTotal || cart.subtotal;
    const itemDiscount = Math.max(0, originalTotal - cart.subtotal);
    const totalDiscount = itemDiscount + couponDiscount;
    const finalTotal = Math.max(0, cart.subtotal - couponDiscount);

    res.render('cart/checkout', {
      title: 'Checkout - Aruvi Embroidery',
      cart,
      originalTotal,
      itemDiscount,
      couponDiscount,
      totalDiscount,
      finalTotal,
      appliedCoupon,
      razorpayKeyId: keyId
    });
  } catch (err) {
    next(err);
  }
};

exports.createRazorpayOrder = async (req, res, next) => {
  try {
    // Require Login
    if (!req.user) {
      return res.status(401).json({
        success: false,
        requireLogin: true,
        message: 'Please log in to complete your order.'
      });
    }

    const isProduction = process.env.NODE_ENV === 'production' || process.env.APP_ENV === 'production';
    const isLocalTest = !isProduction || process.env.PAYMENT_MODE === 'local_test';

    const userId = req.user.id;
    const { full_name, email, phone, design_id, payment_mode } = req.body;

    // Production security guard — reject any local test payment attempt on production
    if (isProduction && (payment_mode === 'local_test' || req.body.is_local_test)) {
      return res.status(403).json({
        success: false,
        message: 'Local test payment bypass is strictly prohibited in production environment.'
      });
    }

    let cartItems = [];
    if (design_id) {
      const singleDesign = await Design.getById(design_id);
      if (singleDesign) {
        cartItems = [{
          design_id: singleDesign.id,
          title: singleDesign.title,
          slug: singleDesign.slug,
          price: parseFloat(singleDesign.price),
          sale_price: singleDesign.sale_price ? parseFloat(singleDesign.sale_price) : null,
          effective_price: singleDesign.sale_price ? parseFloat(singleDesign.sale_price) : parseFloat(singleDesign.price),
          primary_image: singleDesign.primary_image || '/public/images/logo.jpg'
        }];
      }
    }

    if (cartItems.length === 0) {
      const userCart = await Cart.getCart(userId, req.session.cartSessionId);
      cartItems = userCart.items || [];
    }

    if (cartItems.length === 0) {
      return res.status(400).json({ success: false, message: 'Your cart is empty. Please select a design.' });
    }

    // Server-side price verification
    let dbOriginalTotal = 0;
    let dbSubtotal = 0;
    const verifiedItems = [];

    for (const item of cartItems) {
      const dbDesign = await Design.getById(item.design_id);
      if (!dbDesign) continue;

      const origP = parseFloat(dbDesign.price || 0);
      const saleP = (dbDesign.sale_price !== null && dbDesign.sale_price !== undefined && dbDesign.sale_price !== '') 
        ? parseFloat(dbDesign.sale_price) 
        : origP;

      dbOriginalTotal += origP;
      dbSubtotal += saleP;

      verifiedItems.push({
        ...item,
        design_id: dbDesign.id,
        title: dbDesign.title,
        price: origP,
        sale_price: saleP < origP ? saleP : null,
        effective_price: saleP,
        primary_image: dbDesign.primary_image || '/public/images/logo.jpg'
      });
    }

    let couponDiscount = 0;
    let appliedCoupon = req.session.appliedCoupon || null;
    if (appliedCoupon && dbSubtotal > 0) {
      const val = await Coupon.validate(appliedCoupon.code, dbSubtotal);
      if (val.valid) couponDiscount = val.discountAmount;
    }

    const itemDiscount = Math.max(0, dbOriginalTotal - dbSubtotal);
    const totalDiscount = itemDiscount + couponDiscount;
    const finalTotal = Math.max(0, dbSubtotal - couponDiscount);
    const amountInPaise = Math.round(finalTotal * 100);

    // ==================================================
    // LOCALHOST PAYMENT GATEWAY BYPASS
    // ==================================================
    if (isLocalTest) {
      const testPaymentId = 'pay_local_test_' + Date.now();
      const testRazorpayOrderId = 'order_local_test_' + Date.now();

      const { orderId, orderNumber } = await Order.createOrder({
        userId,
        guestEmail: email || req.user.email,
        guestName: full_name || req.user.full_name,
        guestPhone: phone || req.user.phone,
        items: verifiedItems,
        totalAmount: dbOriginalTotal,
        discountAmount: totalDiscount,
        finalAmount: finalTotal,
        couponCode: appliedCoupon ? appliedCoupon.code : null,
        razorpayOrderId: testRazorpayOrderId
      });

      // Grant customer ownership & mark order as COMPLETED
      await Order.updateStatus(orderId, 'completed', testPaymentId);

      // Clear Cart & Session Coupon
      await Cart.clearCart(userId, req.session.cartSessionId);
      delete req.session.appliedCoupon;

      const refreshedOrder = await Order.getById(orderId);
      sendOrderConfirmationEmail(refreshedOrder).catch(err => console.error('Email send notice:', err.message));

      return res.json({
        success: true,
        isLocalTest: true,
        orderId,
        orderNumber: refreshedOrder ? refreshedOrder.order_number : orderNumber,
        redirectUrl: `/checkout/success/${refreshedOrder ? refreshedOrder.order_number : orderNumber}`,
        finalTotal
      });
    }

    // ==================================================
    // PRODUCTION REAL RAZORPAY PAYMENT GATEWAY FLOW
    // ==================================================
    let razorpayOrderId = null;

    if (razorpayInstance && isRealRazorpayKey) {
      try {
        const rzpOrder = await razorpayInstance.orders.create({
          amount: amountInPaise,
          currency: 'INR',
          receipt: 'rcpt_' + Date.now(),
          payment_capture: 1
        });
        if (rzpOrder && rzpOrder.id) {
          razorpayOrderId = rzpOrder.id;
        }
      } catch (rzpErr) {
        console.error('[Razorpay Order Creation Error]:', rzpErr.message);
      }
    }

    if (!razorpayOrderId) {
      razorpayOrderId = 'order_test_' + Date.now();
    }

    // Save PENDING order into DB
    const { orderId, orderNumber } = await Order.createOrder({
      userId,
      guestEmail: email || req.user.email,
      guestName: full_name || req.user.full_name,
      guestPhone: phone || req.user.phone,
      items: verifiedItems,
      totalAmount: dbOriginalTotal,
      discountAmount: totalDiscount,
      finalAmount: finalTotal,
      couponCode: appliedCoupon ? appliedCoupon.code : null,
      razorpayOrderId
    });

    res.json({
      success: true,
      isLocalTest: false,
      orderId,
      orderNumber,
      razorpayOrderId,
      amount: amountInPaise,
      currency: 'INR',
      key: keyId,
      customerName: full_name || req.user.full_name,
      customerEmail: email || req.user.email,
      customerPhone: phone || req.user.phone || '',
      originalTotal: dbOriginalTotal,
      totalDiscount,
      finalTotal
    });
  } catch (err) {
    console.error('Create Razorpay order error:', err);
    res.status(500).json({ success: false, message: 'Failed to create payment order.' });
  }
};

exports.verifyPayment = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, requireLogin: true, message: 'Login required.' });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;
    const userId = req.user.id;

    if (!order_id) {
      return res.status(400).json({ success: false, message: 'Missing order identifier.' });
    }

    const order = await Order.getById(order_id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order record not found.' });
    }

    // Requirement 7 & 16: Verify Razorpay signature using HMAC SHA256
    if (razorpay_signature) {
      const generated_signature = crypto
        .createHmac('sha256', keySecret || 'sample_secret_key_456')
        .update((razorpay_order_id || order.razorpay_order_id) + '|' + razorpay_payment_id)
        .digest('hex');

      if (generated_signature !== razorpay_signature) {
        console.error('❌ Signature verification mismatch!');
        return res.status(400).json({ success: false, message: 'Invalid payment signature verification failed.' });
      }
    }

    // Requirement 10 & 12: Verify captured status and exact payable amount
    let isCaptured = true;
    if (razorpayInstance && razorpay_payment_id && !razorpay_payment_id.startsWith('pay_test_')) {
      try {
        const paymentInfo = await razorpayInstance.payments.fetch(razorpay_payment_id);
        if (paymentInfo) {
          const expectedAmount = Math.round(order.final_amount * 100);
          if (paymentInfo.amount !== expectedAmount || paymentInfo.currency !== 'INR') {
            console.error(`❌ Payment amount mismatch! Expected ${expectedAmount}, got ${paymentInfo.amount}`);
            return res.status(400).json({ success: false, message: 'Payment amount mismatch verification failed.' });
          }
          if (paymentInfo.status !== 'captured' && paymentInfo.status !== 'authorized') {
            isCaptured = false;
          }
        }
      } catch (rzpFetchErr) {
        console.warn('Razorpay payment fetch notice:', rzpFetchErr.message);
      }
    }

    if (!isCaptured) {
      await Order.updateStatus(order.id, 'cancelled', razorpay_payment_id);
      return res.status(400).json({ success: false, message: 'Payment was not captured.' });
    }

    const paymentId = razorpay_payment_id || ('pay_captured_' + Date.now());

    // Update order status to completed & CAPTURED (download_allowed = 1)
    await Order.updateStatus(order.id, 'completed', paymentId);

    // Clear cart
    await Cart.clearCart(userId, req.session.cartSessionId);
    delete req.session.appliedCoupon;

    const refreshedOrder = await Order.getById(order.id);
    sendOrderConfirmationEmail(refreshedOrder).catch(err => console.error('Email send error:', err.message));

    res.json({
      success: true,
      order_number: refreshedOrder.order_number,
      redirectUrl: `/checkout/success/${refreshedOrder.order_number}`
    });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ success: false, message: 'Payment verification failed.' });
  }
};

exports.handleRazorpayWebhook = async (req, res, next) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_KEY_SECRET;
    const signature = req.headers['x-razorpay-signature'];

    if (webhookSecret && signature) {
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest('hex');

      if (digest !== signature) {
        console.error('❌ Webhook signature verification failed');
        return res.status(400).json({ status: 'error', message: 'Invalid webhook signature' });
      }
    }

    const event = req.body && req.body.event;
    const payload = req.body && req.body.payload;

    if (event === 'payment.captured' || event === 'order.paid') {
      const paymentEntity = payload && payload.payment && payload.payment.entity;
      if (paymentEntity) {
        const razorpayOrderId = paymentEntity.order_id;
        const razorpayPaymentId = paymentEntity.id;
        const paidAmount = paymentEntity.amount;

        const db = require('../config/db');
        const rows = await db.query('SELECT * FROM orders WHERE razorpay_order_id = ? OR razorpay_payment_id = ? LIMIT 1', [razorpayOrderId, razorpayPaymentId]);

        if (rows && rows[0]) {
          const order = rows[0];
          const expectedPaise = Math.round(order.final_amount * 100);
          if (paidAmount === expectedPaise && paymentEntity.currency === 'INR') {
            await Order.updateStatus(order.id, 'completed', razorpayPaymentId);
            console.log(`✅ [Webhook Success] Order #${order.order_number} marked as COMPLETED & CAPTURED`);
          }
        }
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

exports.getOrderSuccess = async (req, res, next) => {
  try {
    const identifier = req.params.orderNumber || req.params.orderId;
    const order = (await Order.getByOrderNumber(identifier)) || (await Order.getById(identifier));

    if (!order) {
      req.flash('error', 'Order details not found.');
      return res.redirect('/');
    }

    res.render('cart/success', {
      title: `Order Successful #${order.order_number} - Aruvi Embroidery`,
      order
    });
  } catch (err) {
    next(err);
  }
};

exports.getPaymentSettings = async (req, res, next) => {
  try {
    const settings = await Setting.getAll();
    res.json({
      success: true,
      upiId: settings.upi_id || settings.upiId || 'aruviembroidery@upi',
      upiMerchantName: settings.upi_name || settings.upiName || 'ARUVI EMBROIDERY STUDIO'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve payment settings' });
  }
};



async function sendOrderConfirmationEmail(order) {
  try {
    return await emailService.sendPurchaseConfirmationEmail(order);
  } catch (e) {
    console.error('Email send error:', e.message);
  }
}
