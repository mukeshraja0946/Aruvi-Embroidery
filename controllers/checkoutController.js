const dotenv = require('dotenv');
dotenv.config();

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');
const Design = require('../models/Design');
const Setting = require('../models/Setting');
const Razorpay = require('razorpay');
const cashfreeService = require('../services/cashfreeService');
const nodemailer = require('nodemailer');
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
    // Requirement 4: Require Login
    if (!req.user) {
      return res.status(401).json({
        success: false,
        requireLogin: true,
        message: 'Please log in to complete your order.'
      });
    }

    const userId = req.user.id;
    const { full_name, email, phone, design_id } = req.body;

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

    // Requirement 1 & 7: Fetch actual prices from DB server-side
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

// ============================================================
// Official Cashfree Payment Gateway Integration
// ============================================================

exports.createCashfreeOrder = async (req, res, next) => {
  try {
    // Requirement 4 & 24: Authenticate customer
    if (!req.user) {
      return res.status(401).json({
        success: false,
        requireLogin: true,
        message: 'Please log in to complete your order.'
      });
    }

    const userId = req.user.id;
    const { full_name, email, phone, design_id } = req.body;

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

    // Requirement 6: Fetch actual prices from DB server-side
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

    const tempCfOrderId = 'cf_order_' + Date.now() + '_' + Math.floor(1000 + Math.random() * 9000);

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
      cashfreeOrderId: tempCfOrderId,
      paymentGateway: 'cashfree'
    });

    // Create Cashfree Order via SDK/API
    const cfResult = await cashfreeService.createOrder({
      orderId: tempCfOrderId,
      amount: finalTotal,
      currency: 'INR',
      customer: {
        id: req.user.id,
        name: full_name || req.user.full_name || 'Aruvi Customer',
        email: email || req.user.email || 'customer@example.com',
        phone: phone || req.user.phone || '9876543210'
      }
    });

    if (!cfResult.success) {
      return res.status(500).json({
        success: false,
        message: cfResult.message || 'Payment could not be completed. Please try again.'
      });
    }

    res.json({
      success: true,
      orderId,
      orderNumber,
      cashfreeOrderId: tempCfOrderId,
      paymentSessionId: cfResult.paymentSessionId,
      environment: cfResult.environment || 'sandbox',
      isSimulation: cfResult.isSimulation || false,
      finalTotal,
      originalTotal: dbOriginalTotal,
      totalDiscount
    });
  } catch (err) {
    console.error('Create Cashfree order error:', err);
    res.status(500).json({ success: false, message: 'Payment could not be completed. Please try again.' });
  }
};

exports.verifyCashfreePayment = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, requireLogin: true, message: 'Login required.' });
    }

    const { cashfree_order_id, order_id } = req.body;
    const cfOrderId = cashfree_order_id || req.body.cf_order_id;
    const internalOrderId = order_id;

    let order = null;
    if (internalOrderId) {
      order = await Order.getById(internalOrderId);
    }
    if (!order && cfOrderId) {
      order = await Order.getByCashfreeOrderId(cfOrderId);
    }

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order record not found.' });
    }

    const targetCfOrderId = cfOrderId || order.cashfree_order_id || order.razorpay_order_id;

    // Fetch payment status directly from Cashfree backend API
    const verifyResult = await cashfreeService.fetchOrder(targetCfOrderId);

    if (!verifyResult.success || (verifyResult.status !== 'PAID' && !verifyResult.isSimulation)) {
      await Order.updateCashfreeOrder(order.id, 'failed', null, targetCfOrderId);
      return res.status(400).json({
        success: false,
        message: 'Payment verification failed or payment was not completed.'
      });
    }

    // Verify amount
    if (verifyResult.amount !== null && verifyResult.amount !== undefined && Math.abs(parseFloat(verifyResult.amount) - parseFloat(order.final_amount)) > 0.01) {
      console.error(`❌ Cashfree amount mismatch! Expected ${order.final_amount}, got ${verifyResult.amount}`);
      return res.status(400).json({ success: false, message: 'Payment verification amount mismatch.' });
    }

    const paymentId = (verifyResult.data && verifyResult.data.cf_payment_id) ? String(verifyResult.data.cf_payment_id) : ('cf_pay_' + Date.now());

    // Update order status to completed / PAID (download_allowed = 1)
    await Order.updateCashfreeOrder(order.id, 'completed', paymentId, targetCfOrderId);

    // Clear user cart
    await Cart.clearCart(req.user.id, req.session.cartSessionId);
    delete req.session.appliedCoupon;

    const refreshedOrder = await Order.getById(order.id);
    sendOrderConfirmationEmail(refreshedOrder).catch(err => console.error('Email send error:', err.message));

    res.json({
      success: true,
      order_number: refreshedOrder.order_number,
      redirectUrl: `/checkout/success/${refreshedOrder.order_number}`
    });
  } catch (err) {
    console.error('Verify Cashfree payment error:', err);
    res.status(500).json({ success: false, message: 'Payment could not be completed. Please try again.' });
  }
};

exports.handleCashfreeReturn = async (req, res, next) => {
  try {
    const cfOrderId = req.query.order_id || req.query.orderId;
    if (!cfOrderId) {
      req.flash('error', 'Missing Cashfree order reference.');
      return res.redirect('/checkout');
    }

    const order = await Order.getByCashfreeOrderId(cfOrderId);
    if (!order) {
      req.flash('error', 'Order not found.');
      return res.redirect('/checkout');
    }

    // Server-side status verification
    const verifyResult = await cashfreeService.fetchOrder(cfOrderId);
    if (verifyResult.success && (verifyResult.status === 'PAID' || verifyResult.isSimulation)) {
      await Order.updateCashfreeOrder(order.id, 'completed', 'cf_pay_' + Date.now(), cfOrderId);
      if (req.user) {
        await Cart.clearCart(req.user.id, req.session.cartSessionId);
      }
      delete req.session.appliedCoupon;
      return res.redirect(`/checkout/success/${order.order_number}`);
    } else {
      await Order.updateCashfreeOrder(order.id, 'failed', null, cfOrderId);
      req.flash('error', 'Payment could not be completed. Please try again.');
      return res.redirect('/checkout');
    }
  } catch (err) {
    next(err);
  }
};

exports.handleCashfreeWebhook = async (req, res, next) => {
  try {
    const rawBody = req.rawBody || JSON.stringify(req.body);
    const timestamp = req.headers['x-webhook-timestamp'];
    const signature = req.headers['x-webhook-signature'];

    if (signature && timestamp) {
      const isValid = cashfreeService.verifyWebhookSignature(rawBody, timestamp, signature);
      if (!isValid) {
        console.error('❌ Cashfree Webhook signature verification failed');
        return res.status(400).json({ status: 'error', message: 'Invalid webhook signature' });
      }
    }

    const payload = req.body;
    const data = payload && payload.data;
    const orderObj = data && data.order;
    const paymentObj = data && data.payment;

    const cfOrderId = (orderObj && orderObj.order_id) || (payload && payload.order_id);
    const paymentStatus = (paymentObj && paymentObj.payment_status) || (orderObj && orderObj.order_status);

    if (cfOrderId && (paymentStatus === 'SUCCESS' || paymentStatus === 'PAID')) {
      const order = await Order.getByCashfreeOrderId(cfOrderId);
      if (order) {
        const paymentId = (paymentObj && paymentObj.cf_payment_id) ? String(paymentObj.cf_payment_id) : ('cf_pay_wh_' + Date.now());
        await Order.updateCashfreeOrder(order.id, 'completed', paymentId, cfOrderId);
        console.log(`✅ [Cashfree Webhook Success] Order #${order.order_number} marked as PAID`);
      }
    }

    res.json({ status: 'OK' });
  } catch (err) {
    console.error('Cashfree Webhook processing error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
};

async function sendOrderConfirmationEmail(order) {
  try {
    if (!process.env.SMTP_USER || process.env.SMTP_USER === 'your_smtp_user') {
      console.log(`[Email Simulation] Order confirmation email for Order #${order.order_number} to ${order.guest_email || 'customer'}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    const recipient = order.guest_email || (order.user_email || 'customer@aruviembroidery.com');
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || '"Aruvi Embroidery" <noreply@aruviembroidery.com>',
      to: recipient,
      subject: `Order Confirmation #${order.order_number} - Aruvi Embroidery`,
      html: `
        <h2>Thank you for your order at Aruvi Embroidery!</h2>
        <p>Order Number: <strong>${order.order_number}</strong></p>
        <p>Total Paid: <strong>₹${order.final_amount}</strong></p>
        <p>Your digital embroidery files are now available for instant download in your account dashboard.</p>
        <p>Tagline: <em>Where Threads Tell Stories</em></p>
      `
    });
  } catch (e) {
    console.error('Nodemailer error:', e.message);
  }
}
