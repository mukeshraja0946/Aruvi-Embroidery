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

router.get('/custom-order', pageController.getCustomOrder);
router.post('/custom-order', strictLimiter, upload.single('reference_image'), pageController.postCustomOrder);

router.get('/faq', pageController.getFAQ);
router.get('/blog', pageController.getBlog);
router.get('/privacy', pageController.getPrivacy);
router.get('/terms', pageController.getTerms);
router.get('/refund', pageController.getRefund);
router.get('/unsubscribe', pageController.getUnsubscribe);
router.post('/unsubscribe', pageController.postUnsubscribe);
router.get('/sitemap.xml', pageController.getSitemap);

module.exports = router;
