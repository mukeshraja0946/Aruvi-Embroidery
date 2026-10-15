const dotenv = require('dotenv');
dotenv.config();

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const User = require('../models/User');
const Razorpay = require('razorpay');
const emailService = require('../services/emailService');
const errorLogger = require('../services/errorLogger');
const crypto = require('crypto');
const db = require('../config/db');

let cachedRazorpayClient = null;
let cachedRazorpayKeyId = null;
let cachedRazorpayKeySecret = null;

async function getRazorpayClient() {
  const config = await Setting.getRazorpayConfig();
  if (!config.isConfigured) {
    throw new Error('Razorpay payment gateway keys are not configured. Please contact store administrator.');
  }

  if (
    cachedRazorpayClient &&
    cachedRazorpayKeyId === config.keyId &&
    cachedRazorpayKeySecret === config.keySecret
  ) {
    return { client: cachedRazorpayClient, config };
  }

  try {
    cachedRazorpayClient = new Razorpay({
      key_id: config.keyId,
      key_secret: config.keySecret
    });
    cachedRazorpayKeyId = config.keyId;
    cachedRazorpayKeySecret = config.keySecret;
    return { client: cachedRazorpayClient, config };
  } catch (err) {
    throw new Error(`Failed to initialize Razorpay SDK: ${err.message}`);
  }
}

// Log startup status safely (never printing key secret)
(async () => {
  try {
    const config = await Setting.getRazorpayConfig();
    if (config.isConfigured) {
      console.log(`Razorpay: configured (mode: ${config.mode})`);
    } else {
      console.warn('Razorpay: unconfigured or sample keys detected (mode: test)');
    }
  } catch (_) {}
})();

exports.getCheckout = async (req, res, next) => {
  try {
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

    const originalTotal = cart.originalTotal || cart.subtotal;
    const itemDiscount = Math.max(0, originalTotal - cart.subtotal);
    const totalDiscount = itemDiscount + couponDiscount;
    const finalTotal = Math.max(0, cart.subtotal - couponDiscount);

    const rzpConfig = await Setting.getRazorpayConfig();

    res.render('cart/checkout', {
      title: 'Checkout - Aruvi Embroidery',
      cart,
      originalTotal,
      itemDiscount,
      couponDiscount,
      totalDiscount,
      finalTotal,
      appliedCoupon,
      razorpayKeyId: rzpConfig.keyId
    });
  } catch (err) {
    next(err);
  }
};

/**
 * Creates a pending local order and Razorpay Order on backend with exact server-side pricing.
 */
exports.createRazorpayOrder = async (req, res, next) => {
  const refId = 'REF-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();

  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        requireLogin: true,
        message: 'Please log in to complete your order.',
        referenceId: refId
      });
    }

    const userId = req.user.id;
    const { full_name, email, phone, address, design_id } = req.body;

    const cleanPhone = (phone || (req.user ? req.user.phone : '') || '').trim();
    const cleanAddress = (address || (req.user ? req.user.address : '') || '').trim();

    if (!cleanPhone || cleanPhone.replace(/\D/g, '').length < 10) {
      return res.status(400).json({
        success: false,
        message: 'A valid 10-digit mobile phone number is required at checkout.',
        referenceId: refId
      });
    }

    if (!cleanAddress || cleanAddress.length < 3) {
      return res.status(400).json({
        success: false,
        message: 'Delivery / Studio address is required at checkout.',
        referenceId: refId
      });
    }

    // Update customer profile with phone & address safely
    try {
      await User.updateProfile(userId, {
        full_name: full_name || req.user.full_name,
        phone: cleanPhone,
        address: cleanAddress
      });
    } catch (profileErr) {
      console.warn('[Checkout User Profile Update Warning]:', profileErr.message);
    }

    // Identify cart items
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
      return res.status(400).json({
        success: false,
        message: 'Your cart is empty. Please select an embroidery design.',
        referenceId: refId
      });
    }

    // Calculate total ONLY on the server from DB prices (strictly ignore any client price)
    let dbOriginalTotal = 0;
    let dbSubtotal = 0;
    const verifiedItems = [];

    for (const item of cartItems) {
      const dbDesign = await Design.getById(item.design_id);
      if (!dbDesign) continue;

      // Ensure design is active (not deleted or inactive)
      if (dbDesign.is_active === 0) {
        return res.status(400).json({
          success: false,
          message: `The design "${dbDesign.title}" is currently unavailable. Please remove it from your cart.`,
          referenceId: refId
        });
      }

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

    if (verifiedItems.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No available designs found in your cart.',
        referenceId: refId
      });
    }

    // Apply coupon discount validated against server subtotal
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

    // Create local order with status "pending"
    const { orderId, orderNumber } = await Order.createOrder({
      userId,
      guestEmail: email || req.user.email,
      guestName: full_name || req.user.full_name,
      guestPhone: cleanPhone,
      items: verifiedItems,
      totalAmount: dbOriginalTotal,
      discountAmount: totalDiscount,
      finalAmount: finalTotal,
      couponCode: appliedCoupon ? appliedCoupon.code : null,
      paymentGateway: 'razorpay'
    });

    // Special Case: 100% Free Order (e.g. 100% coupon discount)
    if (amountInPaise === 0) {
      await Order.updateStatus(orderId, 'completed', 'free_coupon_' + Date.now());
      await Cart.clearCart(userId, req.session.cartSessionId);
      delete req.session.appliedCoupon;

      const refreshedOrder = await Order.getById(orderId);
      sendOrderConfirmationEmail(refreshedOrder).catch(err => console.error('Email send notice:', err.message));

      return res.json({
        success: true,
        isFreeOrder: true,
        orderId,
        orderNumber,
        redirectUrl: `/checkout/success/${orderNumber}`,
        finalTotal: 0
      });
    }

    // Check minimum Razorpay amount (INR ₹1 = 100 paise)
    if (amountInPaise < 100) {
      return res.status(400).json({
        success: false,
        message: 'Order total must be at least ₹1 to process online payment.',
        referenceId: refId
      });
    }

    // Initialize Razorpay SDK and retrieve active credentials
    let rzpClient, rzpConfig;
    try {
      const init = await getRazorpayClient();
      rzpClient = init.client;
      rzpConfig = init.config;
    } catch (cfgErr) {
      console.error(`[Razorpay Config Error] [${refId}]:`, cfgErr.message);
      return res.status(500).json({
        success: false,
        message: 'Payment gateway configuration is currently unavailable. Please contact support.',
        referenceId: refId
      });
    }

    // Create official Razorpay Order
    let rzpOrder;
    try {
      rzpOrder = await rzpClient.orders.create({
        amount: amountInPaise,
        currency: 'INR',
        receipt: String(orderNumber).slice(0, 40), // Razorpay limits receipt to 40 characters
        notes: {
          order_id: String(orderId),
          customer_id: String(userId),
          order_number: String(orderNumber)
        },
        payment_capture: 1
      });
    } catch (rzpErr) {
      const statusCode = rzpErr.statusCode || (rzpErr.error && rzpErr.error.code) || 'N/A';
      const description = (rzpErr.error && rzpErr.error.description) || rzpErr.message || 'Razorpay order creation failed.';
      console.error(`[Razorpay Order Error] [${refId}]: HTTP ${statusCode} - ${description}`);

      return res.status(500).json({
        success: false,
        message: `Payment gateway error: ${description}`,
        referenceId: refId
      });
    }

    if (!rzpOrder || !rzpOrder.id) {
      console.error(`[Razorpay Order Error] [${refId}]: Razorpay did not return an order ID`);
      return res.status(500).json({
        success: false,
        message: 'Could not generate payment order. Please try again.',
        referenceId: refId
      });
    }

    // Attach razorpay_order_id to pending local order
    if (db.isConnected()) {
      await db.query('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzpOrder.id, orderId]);
    }

    res.json({
      success: true,
      orderId,
      orderNumber,
      razorpayOrderId: rzpOrder.id,
      amount: amountInPaise,
      currency: 'INR',
      key: rzpConfig.keyId,
      customerName: full_name || req.user.full_name,
      customerEmail: email || req.user.email,
      customerPhone: cleanPhone,
      originalTotal: dbOriginalTotal,
      totalDiscount,
      finalTotal,
      referenceId: refId
    });

  } catch (err) {
    console.error(`[Create Razorpay Order Unhandled] [${refId}]:`, err);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order. Please refresh and try again.',
      referenceId: refId
    });
  }
};

/**
 * Reopens Razorpay payment for an existing pending order (Pay Now button).
 */
exports.reopenRazorpayOrder = async (req, res, next) => {
  const refId = 'REF-REOPEN-' + Date.now().toString(36).toUpperCase();
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, requireLogin: true, message: 'Please log in to make a payment.', referenceId: refId });
    }

    const { order_id } = req.body;
    if (!order_id) {
      return res.status(400).json({ success: false, message: 'Order ID is required.', referenceId: refId });
    }

    const order = await Order.getById(order_id);
    if (!order || (order.user_id !== req.user.id && req.user.role !== 'admin')) {
      return res.status(404).json({ success: false, message: 'Order not found.', referenceId: refId });
    }

    if (order.status === 'completed' || order.status === 'paid') {
      return res.json({ success: true, alreadyPaid: true, redirectUrl: `/user/orders/${order.id}` });
    }

    const amountInPaise = Math.round(Number(order.final_amount) * 100);
    if (amountInPaise < 100) {
      return res.status(400).json({ success: false, message: 'Order total must be at least ₹1 to process online payment.', referenceId: refId });
    }

    const { client: rzpClient, config: rzpConfig } = await getRazorpayClient();

    const rzpOrder = await rzpClient.orders.create({
      amount: amountInPaise,
      currency: 'INR',
      receipt: String(order.order_number).slice(0, 40),
      notes: {
        order_id: String(order.id),
        customer_id: String(req.user.id),
        order_number: String(order.order_number)
      },
      payment_capture: 1
    });

    if (db.isConnected()) {
      await db.query('UPDATE orders SET razorpay_order_id = ? WHERE id = ?', [rzpOrder.id, order.id]);
    }

    res.json({
      success: true,
      key: rzpConfig.keyId,
      amount: rzpOrder.amount,
      currency: 'INR',
      orderId: order.id,
      orderNumber: order.order_number,
      razorpayOrderId: rzpOrder.id,
      customerName: req.user.full_name || order.guest_name,
      customerEmail: req.user.email || order.guest_email,
      customerPhone: req.user.phone || order.guest_phone,
      finalTotal: order.final_amount
    });
  } catch (err) {
    console.error(`[Reopen Razorpay Order Error] [${refId}]:`, err);
    res.status(500).json({
      success: false,
      message: 'Failed to initiate payment. Please contact support.',
      referenceId: refId
    });
  }
};

/**
 * Verifies Razorpay payment signature via HMAC SHA256 and completes the order.
 */
exports.verifyPayment = async (req, res, next) => {
  const refId = 'REF-VERIFY-' + Date.now().toString(36).toUpperCase();

  try {
    if (!req.user) {
      return res.status(401).json({ success: false, requireLogin: true, message: 'Login required.', referenceId: refId });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, order_id } = req.body;
    const userId = req.user.id;

    if (!order_id || !razorpay_payment_id) {
      return res.status(400).json({ success: false, message: 'Missing order or payment reference.', referenceId: refId });
    }

    const order = await Order.getById(order_id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order record not found.', referenceId: refId });
    }

    // Idempotency: If already completed, return immediately without re-processing
    if (order.status === 'completed') {
      return res.json({
        success: true,
        order_number: order.order_number,
        redirectUrl: `/checkout/success/${order.order_number}`
      });
    }

    const { client: rzpClient, config: rzpConfig } = await getRazorpayClient();

    // Verify Razorpay signature using HMAC SHA256
    if (razorpay_signature) {
      const generated_signature = crypto
        .createHmac('sha256', rzpConfig.keySecret)
        .update((razorpay_order_id || order.razorpay_order_id) + '|' + razorpay_payment_id)
        .digest('hex');

      if (generated_signature !== razorpay_signature) {
        console.error(`❌ [Signature Verification Mismatch] [${refId}]: Order #${order.order_number}`);
        return res.status(400).json({
          success: false,
          message: 'Payment signature verification failed. If money was debited, contact support with reference ID.',
          referenceId: refId
        });
      }
    }

    // Verify payment status and payable amount with Razorpay API
    let isCaptured = true;
    try {
      const paymentInfo = await rzpClient.payments.fetch(razorpay_payment_id);
      if (paymentInfo) {
        const expectedAmount = Math.round(order.final_amount * 100);
        if (paymentInfo.amount !== expectedAmount || paymentInfo.currency !== 'INR') {
          console.error(`❌ [Payment Amount Mismatch] [${refId}]: Expected ₹${expectedAmount/100}, got ₹${paymentInfo.amount/100}`);
          return res.status(400).json({
            success: false,
            message: 'Payment amount mismatch verification failed.',
            referenceId: refId
          });
        }
        if (paymentInfo.status !== 'captured' && paymentInfo.status !== 'authorized') {
          isCaptured = false;
        }
      }
    } catch (rzpFetchErr) {
      console.warn(`[Razorpay Payment Fetch Notice] [${refId}]:`, rzpFetchErr.message);
    }

    if (!isCaptured) {
      await Order.updateStatus(order.id, 'failed', razorpay_payment_id);
      return res.status(400).json({
        success: false,
        message: 'Payment was not captured by the bank. Please try again.',
        referenceId: refId
      });
    }

    // Mark order as completed and unlock customer downloads
    await Order.updateStatus(order.id, 'completed', razorpay_payment_id);

    // Record transaction in payments table
    if (db.isConnected()) {
      try {
        await db.query(
          `INSERT INTO payments (order_id, razorpay_payment_id, razorpay_order_id, razorpay_signature, amount, status, payment_method, raw_payload)
           VALUES (?, ?, ?, ?, ?, 'captured', 'razorpay', ?)`,
          [
            order.id,
            razorpay_payment_id,
            razorpay_order_id || order.razorpay_order_id,
            razorpay_signature || null,
            order.final_amount,
            JSON.stringify({ verified_at: new Date(), refId })
          ]
        );
      } catch (payLogErr) {
        console.warn('[Payments Record Warning]:', payLogErr.message);
      }
    }

    // Clear cart and applied coupon
    await Cart.clearCart(userId, req.session.cartSessionId);
    delete req.session.appliedCoupon;

    const refreshedOrder = await Order.getById(order.id);
    sendOrderConfirmationEmail(refreshedOrder).catch(err => console.error('Email send error:', err.message));

    res.json({
      success: true,
      order_number: refreshedOrder ? refreshedOrder.order_number : order.order_number,
      redirectUrl: `/checkout/success/${refreshedOrder ? refreshedOrder.order_number : order.order_number}`
    });
  } catch (err) {
    console.error(`[Verify Payment Error] [${refId}]:`, err);
    res.status(500).json({
      success: false,
      message: 'Payment verification failed. Please contact support if your account was charged.',
      referenceId: refId
    });
  }
};

/**
 * Handles incoming Razorpay Webhooks (payment.captured, payment.failed, order.paid).
 * Idempotent: ensures orders are marked as paid even if the customer closes the browser tab.
 */
exports.handleRazorpayWebhook = async (req, res, next) => {
  try {
    const config = await Setting.getRazorpayConfig();
    const webhookSecret = config.webhookSecret || config.keySecret;
    const signature = req.headers['x-razorpay-signature'];

    if (webhookSecret && signature) {
      const shasum = crypto.createHmac('sha256', webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest('hex');

      if (digest !== signature) {
        console.error('❌ [Razorpay Webhook]: Signature verification failed');
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

        const rows = await db.query(
          'SELECT * FROM orders WHERE razorpay_order_id = ? OR razorpay_payment_id = ? LIMIT 1',
          [razorpayOrderId, razorpayPaymentId]
        );

        if (rows && rows[0]) {
          const order = rows[0];
          const expectedPaise = Math.round(order.final_amount * 100);

          if (paidAmount === expectedPaise && paymentEntity.currency === 'INR') {
            if (order.status !== 'completed') {
              await Order.updateStatus(order.id, 'completed', razorpayPaymentId);

              // Record payment row
              try {
                await db.query(
                  `INSERT INTO payments (order_id, razorpay_payment_id, razorpay_order_id, amount, status, payment_method, raw_payload)
                   VALUES (?, ?, ?, ?, 'captured', 'razorpay', ?)`,
                  [order.id, razorpayPaymentId, razorpayOrderId, order.final_amount, JSON.stringify(paymentEntity)]
                );
              } catch (_) {}

              const refreshedOrder = await Order.getById(order.id);
              sendOrderConfirmationEmail(refreshedOrder).catch(err => console.error('Webhook Email send notice:', err.message));
              console.log(`✅ [Webhook Success]: Order #${order.order_number} marked as COMPLETED & CAPTURED`);
            }
          }
        }
      }
    } else if (event === 'payment.failed') {
      const paymentEntity = payload && payload.payment && payload.payment.entity;
      if (paymentEntity && paymentEntity.order_id) {
        const rows = await db.query(
          'SELECT * FROM orders WHERE razorpay_order_id = ? AND status = "pending" LIMIT 1',
          [paymentEntity.order_id]
        );
        if (rows && rows[0]) {
          await Order.updateStatus(rows[0].id, 'failed', paymentEntity.id);
          console.warn(`⚠️ [Webhook Payment Failed]: Order #${rows[0].order_number} marked as FAILED`);
        }
      }
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[Razorpay Webhook Processing Error]:', err);
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
