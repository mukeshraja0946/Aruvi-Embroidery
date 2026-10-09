const AdminStatsService = require('../../services/adminStatsService');
const ContactMessage = require('../../models/ContactMessage');
const Category = require('../../models/Category');

exports.getDashboard = async (req, res, next) => {
  try {
    const stats = await AdminStatsService.getDashboardStats();
    const { messages: recentMessages } = await ContactMessage.getAll({ limit: 5 });
    const categories = await Category.getAll();

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - ARUVI EMBROIDERY STUDIO',
      stats,
      totalCustomers: stats.totalCustomers,
      totalDesigns: stats.totalDesigns,
      recentMessages,
      categoryLabels: categories.map(c => c.name),
      categoryCounts: categories.map(c => c.design_count || 0)
    });
  } catch (err) {
    next(err);
  }
};

