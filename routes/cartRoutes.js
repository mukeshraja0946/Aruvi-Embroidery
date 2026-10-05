const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');

router.get('/cart', cartController.getCart);
router.post('/cart/add', cartController.addToCart);
router.get('/cart/buy-now', cartController.buyNow);
router.post('/cart/buy-now', cartController.buyNow);
router.post('/cart/remove', cartController.removeFromCart);
router.post('/cart/coupon/apply', cartController.applyCoupon);
router.get('/cart/coupon/remove', cartController.removeCoupon);

module.exports = router;
