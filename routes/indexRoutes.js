const express = require('express');
const router = express.Router();
const homeController = require('../controllers/homeController');
const pageController = require('../controllers/pageController');
const upload = require('../middleware/multerUpload');

const { strictLimiter } = require('../middleware/rateLimiters');

router.get('/', homeController.getHomePage);
router.get('/about', pageController.getAbout);
router.get('/contact', pageController.getContact);
router.post('/contact', strictLimiter, pageController.postContact);

const multer = require('multer');
const rateLimit = require('express-rate-limit');
const path = require('path');

// Dedicated rate limiter strictly for /custom-order POST (5 per hour per IP)
const customOrderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    res.setHeader('Retry-After', '3600');
    const isAjax = req.xhr || (req.headers.accept && req.headers.accept.includes('json')) || req.query.ajax === '1';
    const message = 'Too many custom design requests from this IP. Please wait 1 hour before submitting again.';
    if (isAjax) {
      return res.status(429).json({ success: false, code: 'RATE_LIMIT_EXCEEDED', message });
    }
    req.flash('error', message);
    return res.status(429).redirect('/custom-order');
  }
});

// Dedicated reference image upload for custom design requests (Max 5MB, JPG/PNG/WEBP)
const customOrderUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    if (allowed.includes(ext) || (file.mimetype && file.mimetype.startsWith('image/'))) {
      cb(null, true);
    } else {
      const err = new Error('Invalid file format. Only JPG, PNG, and WEBP image files are allowed.');
      err.code = 'INVALID_FILE_TYPE';
      cb(err);
    }
  }
});

function handleCustomOrderUpload(req, res, next) {
  customOrderUpload.single('reference_image')(req, res, (err) => {
    if (err) {
      const isAjax = Boolean(req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json')) || (req.query && req.query.ajax === '1'));
      let message = 'File upload failed. Please try again.';
      if (err.code === 'LIMIT_FILE_SIZE') {
        message = 'The uploaded reference image exceeds the 5 MB limit. Please select an image under 5 MB.';
      } else if (err.code === 'INVALID_FILE_TYPE' || (err.message && err.message.includes('Invalid file format'))) {
        message = 'Invalid image format. Only JPG, PNG, and WEBP files are allowed.';
      }

      if (isAjax) {
        return res.status(400).json({ success: false, errors: { reference_image: message }, message });
      }
      req.flash('error', message);
      req.flash('field_errors', { reference_image: message });
      req.flash('form_data', req.body);
      return res.redirect('/custom-order');
    }
    next();
  });
}

router.get('/custom-order', pageController.getCustomOrder);
router.post('/custom-order', customOrderLimiter, handleCustomOrderUpload, pageController.postCustomOrder);

router.get('/faq', pageController.getFAQ);
router.get('/blog', pageController.getBlog);
router.get('/privacy', pageController.getPrivacy);
router.get('/terms', pageController.getTerms);
router.get('/refund', pageController.getRefund);
router.get('/unsubscribe', pageController.getUnsubscribe);
router.post('/unsubscribe', pageController.postUnsubscribe);
router.get('/sitemap.xml', pageController.getSitemap);

module.exports = router;
