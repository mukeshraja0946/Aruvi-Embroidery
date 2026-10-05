const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/auth');

router.use('/user', isAuthenticated);

router.get('/user/dashboard', userController.getDashboard);
router.post('/user/profile/update', userController.updateProfile);
router.get('/user/orders/:id', userController.getOrderDetail);
router.get('/user/download/:fileId', userController.downloadDesignFile);
router.get('/user/download-format/:designId/:format', userController.downloadDesignFormat);
router.get('/user/wishlist', userController.getWishlist);
router.post('/user/wishlist/toggle', userController.toggleWishlist);

module.exports = router;
