const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { isAuthenticated } = require('../middleware/auth');

function ensureAuthOrToken(req, res, next) {
  if (req.user) return next();
  if (req.query && req.query.token && req.query.uid) return next();
  req.flash('error', 'Please log in to access your downloads.');
  if (req.session) {
    req.session.returnTo = req.originalUrl;
  }
  return res.redirect('/auth/login');
}

// Downloads (support both authenticated users and secure signed tokens)
router.get('/user/download/file/:fileId', ensureAuthOrToken, userController.downloadSingleFile);
router.get('/user/download/:designId/all', ensureAuthOrToken, userController.downloadDesignAllZip);
router.get('/user/download/:designId', ensureAuthOrToken, userController.downloadDesignAllZip);
router.get('/user/orders/:id/download-all', ensureAuthOrToken, userController.downloadOrderAllZip);
router.get('/user/download-format/:designId/:format', ensureAuthOrToken, userController.downloadDesignFormat);

// Account and download redirects
router.get('/account/downloads', (req, res) => res.redirect('/user/dashboard#purchased-downloads'));
router.get('/account', (req, res) => res.redirect('/user/dashboard'));

// Standard authenticated user routes
router.use('/user', isAuthenticated);

router.get('/user/dashboard', userController.getDashboard);
router.get('/user/orders', (req, res) => res.redirect('/user/dashboard#order-history'));
router.get('/user/downloads', (req, res) => res.redirect('/user/dashboard#purchased-downloads'));
router.get('/user/profile', (req, res) => res.redirect('/user/dashboard'));
router.get('/user/complete-profile', userController.getCompleteProfile);
router.post('/user/complete-profile', userController.postCompleteProfile);
router.post('/user/profile/update', userController.updateProfile);
router.get('/user/orders/:id', userController.getOrderDetail);
router.get('/user/wishlist', userController.getWishlist);
router.post('/user/change-password', userController.changePassword);
router.post('/user/wishlist/toggle', userController.toggleWishlist);

module.exports = router;

