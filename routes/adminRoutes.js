const express = require('express');
const router = express.Router();
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const upload = require('../middleware/multerUpload');
const { spreadsheetUploadMiddleware } = require('../middleware/spreadsheetUpload');
const { bulkImageUploadMiddleware } = require('../middleware/bulkImageUpload');
const { bulkZipChunkMiddleware, bulkZipDirectUploadMiddleware, singleZipUploadMiddleware } = require('../middleware/bulkZipUpload');
const { bulkDetailsUploadMiddleware } = require('../middleware/bulkDetailsUpload');

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
const adminEmailCampaignController = require('../controllers/admin/adminEmailCampaignController');
const adminReviewController = require('../controllers/admin/adminReviewController');

// 1. Unprotected Admin Login Routes
router.get('/admin/login', adminAuthController.getLogin);
router.post('/admin/login', adminAuthController.postLogin);
router.get('/admin/logout', adminAuthController.logout);

// 2. Role-Protected Admin Routes (strictly requires admin login)
router.use('/admin', isAdmin);
router.use('/api/admin', isAdmin);

// Rate limiter for critical reset operations
const rateLimit = require('express-rate-limit');
const resetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many reset requests. Please wait 15 minutes before trying again.' }
});

// Dashboard
router.get('/admin', adminDashboardController.getDashboard);
router.get('/api/admin/dashboard/stats', async (req, res) => {
  try {
    const AdminStatsService = require('../services/adminStatsService');
    const includeTestData = req.query.includeTestData === '1' || req.query.includeTestData === 'true' || Boolean(req.session && req.session.includeTestData);
    const stats = await AdminStatsService.getDashboardStats({ includeTestData });
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Store Data Reset (Super Admin only, CSRF protected, rate limited, server-side)
router.get('/api/admin/reset/counts', adminDashboardController.getResetCounts);
router.post('/api/admin/reset/preview', adminDashboardController.postResetPreview);
router.post('/api/admin/reset/execute', resetLimiter, adminDashboardController.postExecuteReset);
router.get('/admin/reset/backup/download/:filename', adminDashboardController.downloadResetBackup);
router.post('/api/admin/reset/restore', resetLimiter, adminDashboardController.postRestoreBackup);

// Products / Designs Management (supports both /admin/products and /admin/designs)
router.get('/admin/products', adminDesignController.getDesigns);
router.get('/admin/designs', adminDesignController.getDesigns);
router.get('/admin/designs/next-sku', adminDesignController.getNextSku);

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
router.post('/admin/designs/replace-image/:id', upload.any(), adminDesignController.replaceImage);
router.post('/admin/designs/bulk-upload-images', bulkImageUploadMiddleware, adminDesignController.bulkUploadImages);
router.get('/admin/designs/bulk-upload-check', adminDesignController.bulkUploadCheck);
router.post('/admin/designs/bulk-link-single-image', adminDesignController.linkSingleImage);

// Bulk Image Replace by Category (Task 2)
router.get('/admin/designs/bulk-replace/scope-summary', adminDesignController.getBulkReplaceScopeSummary);
router.get('/admin/designs/bulk-replace/groups', adminDesignController.getBulkReplaceCategoryGroups);
router.post('/admin/designs/bulk-replace/preview-match', adminDesignController.postBulkReplacePreviewMatch);
router.post('/admin/designs/bulk-replace/upload-chunk', upload.array('files', 50), adminDesignController.postBulkReplaceUploadChunk);
router.post('/admin/designs/bulk-replace/commit', adminDesignController.postBulkReplaceCommit);
router.post('/admin/designs/bulk-replace/undo/:id', adminDesignController.postBulkReplaceUndo);
router.get('/admin/designs/bulk-replace/history', adminDesignController.getBulkReplaceHistory);
router.get('/admin/designs/bulk-replace/export-csv/:id', adminDesignController.getBulkReplaceExportCsv);
router.get('/admin/tools/image-replace-history', adminDesignController.getBulkReplaceHistory);

router.get('/admin/designs/bulk-zip-check', adminDesignController.bulkZipCheck);
router.post('/admin/designs/bulk-zip-dry-run', adminDesignController.bulkZipDryRun);
router.post('/admin/designs/bulk-zip-chunk', bulkZipChunkMiddleware, adminDesignController.bulkZipChunk);
router.post('/admin/designs/bulk-zip-complete', adminDesignController.bulkZipComplete);
router.post('/admin/designs/bulk-upload-zips', bulkZipDirectUploadMiddleware, adminDesignController.bulkUploadZipsDirect);
router.post('/admin/designs/bulk-link-single-zip', adminDesignController.linkSingleZip);
router.post('/admin/designs/replace-zip/:id', singleZipUploadMiddleware, adminDesignController.replaceZipSingle);
router.post('/admin/designs/:id/replace-zip', singleZipUploadMiddleware, adminDesignController.replaceZipSingle);

router.get('/admin/designs/import-template', adminDesignController.downloadImportTemplate);
router.post('/admin/designs/import-preview', spreadsheetUploadMiddleware, adminDesignController.postImportPreview);
router.post('/admin/designs/import-upload-assets', upload.any(), adminDesignController.postImportUploadAssets);
router.post('/admin/designs/import-start-job', adminDesignController.postImportStartJob);
router.get('/admin/designs/import-job-status/:batchId', adminDesignController.getImportJobStatus);
router.post('/admin/designs/import-rollback/:batchId', adminDesignController.postImportRollback);
router.get('/admin/designs/import-error-report/:batchId', adminDesignController.downloadImportErrorReport);
// Multiple Files per Design - Chunked Upload & File Management Endpoints
router.post('/admin/api/designs/upload-chunk', bulkZipChunkMiddleware, adminDesignController.uploadDesignFileChunk);
router.post('/admin/api/designs/upload-complete', adminDesignController.uploadDesignFileComplete);
router.post('/admin/api/designs/:designId/files/update-label/:fileId', adminDesignController.updateFileLabel);
router.post('/admin/api/designs/:designId/files/delete/:fileId', adminDesignController.deleteFile);
router.post('/admin/api/designs/:designId/files/reorder', adminDesignController.reorderDesignFiles);
router.post('/admin/api/designs/:designId/images/reorder', adminDesignController.reorderDesignImages);
router.post('/admin/api/designs/:designId/images/set-primary/:imageId', adminDesignController.setPrimaryImage);
router.post('/admin/api/designs/:designId/images/delete/:imageId', adminDesignController.deleteImage);
router.get('/admin/api/designs/files/:fileId/download', adminDesignController.downloadAdminFile);

// CSRF Token endpoint for client-side AJAX requests & dynamic refreshes
router.get('/admin/api/csrf-token', (req, res) => {
  const token = typeof req.csrfToken === 'function' ? req.csrfToken() : (req.session?.csrfSecret || res.locals?.csrfToken || '');
  res.json({ success: true, csrfToken: token });
});

// Bulk Update Design Details (TXT, PDF, Word, Excel, Notes)
router.get('/admin/designs/bulk-details', adminDesignController.getBulkDetails);
router.get('/admin/designs/bulk-details/template', adminDesignController.downloadBulkDetailsTemplate);
router.get('/admin/designs/bulk-details/template/:format', adminDesignController.downloadBulkDetailsTemplate);
router.post('/admin/designs/bulk-details/preview', bulkDetailsUploadMiddleware, adminDesignController.postBulkDetailsPreview);
router.post('/admin/designs/bulk-details/apply', adminDesignController.postBulkDetailsApply);
router.post('/admin/designs/bulk-details/error-report', adminDesignController.downloadBulkDetailsErrorReport);

router.post('/admin/products/delete/:id', adminDesignController.deleteDesign);
router.post('/admin/designs/delete/:id', adminDesignController.deleteDesign);
router.post('/admin/designs/duplicate/:id', adminDesignController.duplicateDesign);
router.post('/admin/designs/delete-all', adminDesignController.deleteAllDesigns);
router.post('/admin/designs/delete-bulk', adminDesignController.deleteBulkDesigns);

// Bulk Price Updates & Inline Price Editing
router.post('/admin/api/bulk-price/count', adminDesignController.getBulkPriceCount);
router.post('/admin/api/bulk-price/preview', upload.single('file'), adminDesignController.getBulkPricePreview);
router.post('/admin/api/bulk-price/apply', adminDesignController.applyBulkPriceUpdate);
router.post('/admin/api/designs/:id/inline-price', adminDesignController.updateInlinePrice);

// Bulk Stitch Updates & Design Export
router.get('/admin/designs/bulk-stitch/template', adminDesignController.downloadBulkStitchTemplate);
router.post('/admin/api/bulk-stitch/count', adminDesignController.getBulkStitchCount);
router.post('/admin/api/bulk-stitch/preview', upload.single('file'), adminDesignController.getBulkStitchPreview);
router.post('/admin/api/bulk-stitch/apply', adminDesignController.applyBulkStitchUpdate);
router.get('/admin/designs/export', adminDesignController.exportDesigns);

// Categories Management
router.get('/admin/categories', adminCategoryController.getCategories);
router.post('/admin/categories/create', upload.single('image'), adminCategoryController.postCreate);
router.post('/admin/categories/edit/:id', upload.single('image'), adminCategoryController.postUpdate);
router.post('/admin/categories/toggle-status/:id', adminCategoryController.toggleStatus);
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

// Customer Reviews Management
router.get('/admin/reviews', adminReviewController.getReviews);
router.post('/admin/reviews/toggle-status/:id', adminReviewController.toggleStatus);
router.post('/admin/reviews/delete/:id', adminReviewController.deleteReview);

// Coupons
router.get('/admin/coupons', adminCouponController.getCoupons);
router.post('/admin/coupons/create', adminCouponController.postCreate);
router.post('/admin/coupons/delete/:id', adminCouponController.deleteCoupon);

// Contact Messages / Enquiries
router.get('/admin/messages', adminMessageController.getMessages);
router.post('/admin/messages/create', adminMessageController.createEnquiry);
router.post('/admin/messages/status/:id', adminMessageController.updateStatus);
router.post('/admin/messages/delete/:id', adminMessageController.deleteMessage);

// Banners Management
router.get('/admin/banners', adminBannerController.getBanners);
router.post('/admin/banners/create', upload.single('image'), adminBannerController.postCreate);
router.post('/admin/banners/toggle-status/:id', adminBannerController.toggleStatus);
router.post('/admin/banners/delete/:id', adminBannerController.deleteBanner);

// Homepage Editor
router.get('/admin/homepage', adminSettingController.getHomepageEditor);
router.post('/admin/homepage', upload.single('hero_image'), adminSettingController.postHomepageEditor);

// Site Settings, SMTP Test & Branding Logo Management
router.get('/admin/settings', adminSettingController.getSettings);
router.post('/admin/settings', upload.fields([
  { name: 'logo_image', maxCount: 1 },
  { name: 'mobile_logo_image', maxCount: 1 },
  { name: 'favicon_image', maxCount: 1 },
  { name: 'about_story_image', maxCount: 1 },
  { name: 'contact_map_image', maxCount: 1 }
]), adminSettingController.postSettings);

router.all('/admin/api/test-smtp', adminSettingController.testSmtp);
router.all('/admin/api/test-razorpay', adminSettingController.testRazorpay);
router.all('/admin/settings/test-razorpay', adminSettingController.testRazorpay);

// Email Campaigns Management
router.get('/admin/email-campaigns', adminEmailCampaignController.getCampaignsPage);
router.get('/admin/api/email-campaigns/recipients', adminEmailCampaignController.getRecipients);
router.post('/admin/api/email-campaigns/save-draft', adminEmailCampaignController.saveDraft);
router.post('/admin/api/email-campaigns/send-test', adminEmailCampaignController.sendTestEmail);
router.post('/admin/api/email-campaigns/send', adminEmailCampaignController.sendCampaign);
router.post('/admin/api/email-campaigns/retry', adminEmailCampaignController.retryFailed);
router.get('/admin/api/email-campaigns/details/:id', adminEmailCampaignController.getCampaignDetails);
router.post('/admin/api/email-campaigns/delete/:id', adminEmailCampaignController.deleteCampaign);
// Storage Recovery & Bulk Relink Tools
const adminToolsController = require('../controllers/admin/adminToolsController');

router.get('/admin/tools/missing-files', adminToolsController.getMissingFiles);
router.post('/admin/tools/missing-files/trigger-scan', adminToolsController.triggerFullScan);
router.get('/admin/tools/missing-files/scan-status', adminToolsController.getScanStatus);
router.get('/admin/tools/missing-files/export-csv', adminToolsController.exportMissingFilesCsv);
router.get('/admin/tools/missing-files/clean-broken-images/dry-run', adminToolsController.getBrokenImagesDryRun);
router.post('/admin/tools/missing-files/clean-broken-images', adminToolsController.cleanBrokenImageRows);
router.get('/admin/tools/missing-files/clean-broken-images/download-sql', adminToolsController.downloadCleanBrokenImagesSql);
router.post('/admin/tools/replace-file-quick', upload.single('file'), adminToolsController.replaceDesignFileQuick);

router.get('/admin/tools/regenerate-previews', adminToolsController.getRegeneratePreviews);
router.post('/admin/tools/regenerate-previews', adminToolsController.postRegeneratePreviews);

router.get('/admin/tools/bulk-image-relink', adminToolsController.getBulkImageRelink);
router.get('/admin/tools/bulk-image-relink/export-report', adminToolsController.getBulkImageRelinkExport);
router.post('/admin/tools/bulk-image-relink/preview', upload.single('zip_file'), adminToolsController.postBulkImageRelinkPreview);
router.post('/admin/tools/bulk-image-relink/commit', adminToolsController.postBulkImageRelinkCommit);

router.get('/admin/tools/bulk-file-relink', adminToolsController.getBulkFileRelink);
router.get('/admin/tools/bulk-file-relink/export-report', adminToolsController.getBulkFileRelinkExport);
router.post('/admin/tools/bulk-file-relink/preview', upload.single('zip_file'), adminToolsController.postBulkFileRelinkPreview);
router.post('/admin/tools/bulk-file-relink/commit', adminToolsController.postBulkFileRelinkCommit);

router.get('/admin/tools/backup', adminToolsController.getBackupPage);
router.post('/admin/tools/backup/run', adminToolsController.postRunBackup);
router.get('/admin/tools/backup/download/:filename', adminToolsController.downloadBackup);
router.post('/admin/tools/backup/restore', adminToolsController.postRestoreBackup);

// Database & System Health Dashboard
router.get('/admin/tools/system-health', adminToolsController.getSystemHealth);
router.post('/admin/tools/system-health/migrate', adminToolsController.postRunMigrations);
router.get('/admin/tools/system-health/download-sync-sql', adminToolsController.downloadProductionSyncSql);

// Price Update History & Audit
router.get('/admin/tools/price-history', adminToolsController.getPriceHistory);
router.get('/admin/tools/price-history/:id', adminToolsController.getPriceHistoryDetail);
router.post('/admin/tools/price-history/undo/:id', adminToolsController.undoPriceHistory);
router.get('/admin/tools/price-history/download/:id', adminToolsController.downloadPriceHistoryCsv);

// Stitch Update History & Audit (Update History)
router.get('/admin/tools/stitch-history', adminToolsController.getStitchHistory);
router.get('/admin/tools/update-history', adminToolsController.getStitchHistory);
router.get('/admin/tools/stitch-history/:id', adminToolsController.getStitchHistoryDetail);
router.post('/admin/tools/stitch-history/undo/:id', adminToolsController.undoStitchHistory);
router.get('/admin/tools/stitch-history/download/:id', adminToolsController.downloadStitchHistoryCsv);

// Duplicate Files Detection & Cleanup
router.get('/admin/tools/duplicate-files', adminToolsController.getDuplicateFiles);
router.post('/admin/tools/duplicate-files/clean', adminToolsController.cleanDuplicateFiles);
router.post('/admin/tools/duplicate-files/undo/:backupFileName', adminToolsController.undoDuplicateFiles);

module.exports = router;

