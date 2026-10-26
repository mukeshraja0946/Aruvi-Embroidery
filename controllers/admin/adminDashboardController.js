const fs = require('fs');
const path = require('path');
const AdminStatsService = require('../../services/adminStatsService');
const AdminResetService = require('../../services/adminResetService');
const ContactMessage = require('../../models/ContactMessage');
const Category = require('../../models/Category');
const Setting = require('../../models/Setting');
const healthCheckService = require('../../services/healthCheckService');

const projectRoot = path.resolve(__dirname, '..', '..');
const primaryBackupsDir = path.join(projectRoot, 'storage_private', 'backups');
const legacyBackupsDir = path.join(projectRoot, 'backups');

/**
 * Main Admin Dashboard View
 */
exports.getDashboard = async (req, res, next) => {
  try {
    if (req.query.includeTestData !== undefined) {
      req.session.includeTestData = req.query.includeTestData === '1' || req.query.includeTestData === 'true';
    }
    const includeTestData = Boolean(req.session && req.session.includeTestData);

    const stats = await AdminStatsService.getDashboardStats({ includeTestData });
    const { messages: recentMessages } = await ContactMessage.getAll({ limit: 5 });
    const categories = await Category.getAll();
    const healthScan = await healthCheckService.runHealthScan();
    const paymentConfig = await Setting.getRazorpayConfig();

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - ARUVI EMBROIDERY STUDIO',
      stats,
      totalCustomers: stats.totalCustomers,
      totalDesigns: stats.totalDesigns,
      designsBreakdown: stats.designsBreakdown || { total: stats.totalDesigns, active: stats.totalDesigns, inactive: 0 },
      recentMessages,
      categoryLabels: categories.map(c => c.name),
      categoryCounts: categories.map(c => c.design_count || 0),
      healthScan,
      paymentConfig,
      includeTestData,
      csrfToken: (typeof req.csrfToken === 'function') ? req.csrfToken() : (res.locals.csrfToken || '')
    });
  } catch (err) {
    next(err);
  }
};

/**
 * API: Get live deletion counts for all selective reset options
 */
exports.getResetCounts = async (req, res) => {
  try {
    const counts = await AdminResetService.getLiveCounts();
    res.json({ success: true, counts });
  } catch (err) {
    console.error('[AdminResetController.getResetCounts error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * API: Calculate impact preview for chosen reset options
 */
exports.postResetPreview = async (req, res) => {
  try {
    const preview = await AdminResetService.getPreview(req.body);
    res.json({ success: true, preview });
  } catch (err) {
    console.error('[AdminResetController.postResetPreview error]:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * API: Execute the atomic store data reset (Admin only, password verified, CSRF protected, rate limited)
 */
exports.postExecuteReset = async (req, res) => {
  try {
    const adminUser = req.user;
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Super admin privileges required.' });
    }

    const result = await AdminResetService.executeReset(req.body, adminUser, req);
    res.json(result);
  } catch (err) {
    console.error('[AdminResetController.postExecuteReset error]:', err);
    res.status(400).json({ success: false, error: err.message });
  }
};

/**
 * Download a generated pre-reset backup file (SQL / CSV)
 */
exports.downloadResetBackup = async (req, res) => {
  try {
    const filename = path.basename(req.params.filename || '');
    if (!filename || (!filename.endsWith('.sql') && !filename.endsWith('.csv') && !filename.endsWith('.zip'))) {
      return res.status(400).send('Invalid backup filename.');
    }

    let filePath = path.join(primaryBackupsDir, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(legacyBackupsDir, filename);
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).send('Backup file not found or has been pruned (kept for 30 days).');
    }

    res.download(filePath, filename);
  } catch (err) {
    console.error('[AdminResetController.downloadResetBackup error]:', err);
    res.status(500).send('Failed to download backup file.');
  }
};

/**
 * API: Restore from a pre-reset backup file
 */
exports.postRestoreBackup = async (req, res) => {
  try {
    const adminUser = req.user;
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Access denied. Admin privileges required.' });
    }

    const { filename, password } = req.body;
    if (!filename || !password) {
      return res.status(400).json({ success: false, error: 'Backup filename and admin password are required.' });
    }

    const result = await AdminResetService.restoreBackup(filename, adminUser, password);
    res.json(result);
  } catch (err) {
    console.error('[AdminResetController.postRestoreBackup error]:', err);
    res.status(400).json({ success: false, error: err.message });
  }
};
