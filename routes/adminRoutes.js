const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const upload = require('../middleware/multerUpload');

const adminAuthController = require('../controllers/admin/adminAuthController');
const adminDashboardController = require('../controllers/admin/adminDashboardController');
const adminDesignController = require('../controllers/admin/adminDesignController');
const adminCategoryController = require('../controllers/admin/adminCategoryController');
const adminOrderController = require('../controllers/admin/adminOrderController');
const adminCustomOrderController = require('../controllers/admin/adminCustomOrderController');
const adminCustomerController = require('../controllers/admin/adminCustomerController');
const adminCouponController = require('../controllers/admin/adminCouponController');
const adminMessageController = require('../controllers/admin/adminMessageController');
const adminBannerController = require('../controllers/admin/adminBannerController');
const adminSettingController = require('../controllers/admin/adminSettingController');

// 1. Unprotected Admin Login Routes
router.get('/admin/login', adminAuthController.getLogin);
router.post('/admin/login', adminAuthController.postLogin);
router.get('/admin/logout', adminAuthController.logout);

// 2. Role-Protected Admin Routes (strictly requires admin login)
router.use('/admin', isAdmin);

// Dashboard
router.get('/admin', adminDashboardController.getDashboard);

// Products / Designs Management (supports both /admin/products and /admin/designs)
router.get('/admin/products', adminDesignController.getDesigns);
router.get('/admin/designs', adminDesignController.getDesigns);

router.get('/admin/products/create', adminDesignController.getCreateForm);
router.get('/admin/designs/create', adminDesignController.getCreateForm);
router.post('/admin/products/create', upload.any(), adminDesignController.postCreate);
router.post('/admin/designs/create', upload.any(), adminDesignController.postCreate);

router.get('/admin/products/edit/:id', adminDesignController.getEditForm);
router.get('/admin/designs/edit/:id', adminDesignController.getEditForm);
router.post('/admin/products/edit/:id', upload.any(), adminDesignController.postEdit);
router.post('/admin/designs/edit/:id', upload.any(), adminDesignController.postEdit);

router.post('/admin/designs/toggle-status/:id', adminDesignController.toggleStatus);
router.post('/admin/designs/delete-image/:imageId', adminDesignController.deleteImage);
router.post('/admin/designs/set-primary-image/:imageId', adminDesignController.setPrimaryImage);
router.post('/admin/designs/delete-file/:fileId', adminDesignController.deleteFile);
router.post('/admin/designs/delete-all-files/:designId', adminDesignController.deleteAllFiles);

router.post('/admin/products/delete/:id', adminDesignController.deleteDesign);
router.post('/admin/designs/delete/:id', adminDesignController.deleteDesign);
router.post('/admin/designs/delete-all', adminDesignController.deleteAllDesigns);
router.post('/admin/designs/delete-bulk', adminDesignController.deleteBulkDesigns);

// Categories Management
router.get('/admin/categories', adminCategoryController.getCategories);
router.post('/admin/categories/create', upload.single('image'), adminCategoryController.postCreate);
router.post('/admin/categories/edit/:id', upload.single('image'), adminCategoryController.postUpdate);
router.post('/admin/categories/delete/:id', adminCategoryController.deleteCategory);

// Orders Management
router.get('/admin/orders', adminOrderController.getOrders);
router.get('/admin/orders/:id', adminOrderController.getOrderDetail);
router.post('/admin/orders/status/:id', adminOrderController.updateOrderStatus);
router.post('/admin/orders/delete/:id', adminOrderController.deleteOrder);

// Custom Orders Requests
router.get('/admin/custom-orders', adminCustomOrderController.getCustomOrders);
router.post('/admin/custom-orders/status/:id', adminCustomOrderController.updateStatus);
router.post('/admin/custom-orders/delete/:id', adminCustomOrderController.deleteCustomOrder);

// Customers Directory
router.get('/admin/customers', adminCustomerController.getCustomers);
router.post('/admin/customers/delete/:id', adminCustomerController.deleteCustomer);

// Coupons
router.get('/admin/coupons', adminCouponController.getCoupons);
router.post('/admin/coupons/create', adminCouponController.postCreate);
router.post('/admin/coupons/delete/:id', adminCouponController.deleteCoupon);

// Contact Messages / Enquiries
router.get('/admin/messages', adminMessageController.getMessages);
router.post('/admin/messages/status/:id', adminMessageController.updateStatus);
router.post('/admin/messages/delete/:id', adminMessageController.deleteMessage);

// Banners Management
router.get('/admin/banners', adminBannerController.getBanners);
router.post('/admin/banners/create', upload.single('image'), adminBannerController.postCreate);
router.post('/admin/banners/delete/:id', adminBannerController.deleteBanner);

// Homepage Editor
router.get('/admin/homepage', adminSettingController.getHomepageEditor);
router.post('/admin/homepage', upload.single('hero_image'), adminSettingController.postHomepageEditor);

// Site Settings, SMTP Test & Branding Logo Management
router.get('/admin/settings', adminSettingController.getSettings);
router.post('/admin/settings', upload.fields([
  { name: 'logo_image', maxCount: 1 },
  { name: 'mobile_logo_image', maxCount: 1 },
  { name: 'favicon_image', maxCount: 1 }
]), adminSettingController.postSettings);

router.all('/admin/api/test-smtp', adminSettingController.testSmtp);

module.exports = router;
