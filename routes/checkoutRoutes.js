const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');

router.get('/checkout', checkoutController.getCheckout);
router.get('/api/settings/payment', checkoutController.getPaymentSettings);
router.get('/checkout/payment-settings', checkoutController.getPaymentSettings);

// Official Razorpay Gateway API Routes
router.post('/api/payment/create-order', checkoutController.createRazorpayOrder);
router.post('/checkout/create-order', checkoutController.createRazorpayOrder);
router.post('/api/payment/verify', checkoutController.verifyPayment);
router.post('/checkout/verify-payment', checkoutController.verifyPayment);
router.post('/api/payment/webhook', checkoutController.handleRazorpayWebhook);
router.post('/checkout/webhook', checkoutController.handleRazorpayWebhook);

// Official Cashfree Gateway API Routes
router.post('/api/payment/cashfree/create-order', checkoutController.createCashfreeOrder);
router.post('/checkout/cashfree/create-order', checkoutController.createCashfreeOrder);
router.post('/api/payment/cashfree/verify', checkoutController.verifyCashfreePayment);
router.get('/checkout/cashfree-return', checkoutController.handleCashfreeReturn);
router.post('/api/payment/cashfree/webhook', checkoutController.handleCashfreeWebhook);

router.get('/checkout/success/:orderNumber', checkoutController.getOrderSuccess);
router.get('/order-success/:orderId', checkoutController.getOrderSuccess);

module.exports = router;
