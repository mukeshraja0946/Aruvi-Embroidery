const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');

const { strictLimiter } = require('../middleware/rateLimiters');

router.get('/checkout', checkoutController.getCheckout);
router.get('/api/settings/payment', checkoutController.getPaymentSettings);
router.get('/checkout/payment-settings', checkoutController.getPaymentSettings);

// Official Razorpay Gateway API Routes
router.post('/api/payment/create-order', strictLimiter, checkoutController.createRazorpayOrder);
router.post('/checkout/create-order', strictLimiter, checkoutController.createRazorpayOrder);
router.post('/api/payment/reopen-order', strictLimiter, checkoutController.reopenRazorpayOrder);
router.post('/api/payment/verify', strictLimiter, checkoutController.verifyPayment);
router.post('/checkout/verify-payment', strictLimiter, checkoutController.verifyPayment);
router.post('/api/payment/webhook', checkoutController.handleRazorpayWebhook);
router.post('/checkout/webhook', checkoutController.handleRazorpayWebhook);

router.get('/checkout/success/:orderNumber', checkoutController.getOrderSuccess);
router.get('/order-success/:orderId', checkoutController.getOrderSuccess);

module.exports = router;
