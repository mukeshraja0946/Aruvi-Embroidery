const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/auth');

router.use('/user', isAuthenticated);

router.get('/user/dashboard', userController.getDashboard);
router.get('/user/orders', (req, res) => res.redirect('/user/dashboard#order-history'));
router.get('/user/downloads', (req, res) => res.redirect('/user/dashboard#purchased-downloads'));
router.get('/user/profile', (req, res) => res.redirect('/user/dashboard'));
router.get('/user/complete-profile', userController.getCompleteProfile);
router.post('/user/complete-profile', userController.postCompleteProfile);
router.post('/user/profile/update', userController.updateProfile);
router.get('/user/orders/:id', userController.getOrderDetail);
router.get('/user/download/:fileId', userController.downloadDesignFile);
router.get('/user/download-format/:designId/:format', userController.downloadDesignFormat);
router.get('/user/wishlist', userController.getWishlist);
router.post('/user/wishlist/toggle', userController.toggleWishlist);

module.exports = router;
