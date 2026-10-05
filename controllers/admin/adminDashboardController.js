const Order = require('../../models/Order');
const User = require('../../models/User');
const Design = require('../../models/Design');
const CustomOrder = require('../../models/CustomOrder');
const ContactMessage = require('../../models/ContactMessage');
const Category = require('../../models/Category');

exports.getDashboard = async (req, res, next) => {
  try {
    const stats = await Order.getStats();
    const totalCustomers = await User.count();
    const totalDesigns = await Design.count();
    const customRequestsCount = await CustomOrder.count();
    const { messages: recentMessages } = await ContactMessage.getAll({ limit: 5 });
    const categories = await Category.getAll();

    // Chart Data
    const monthlySales = [12000, 18500, 15000, 24000, 21000, 34000];
    const categoryLabels = categories.map(c => c.name);
    const categoryCounts = categories.map(c => c.design_count || 10);

    res.render('admin/dashboard', {
      title: 'Admin Dashboard - ARUVI EMBROIDERY STUDIO',
      stats,
      totalCustomers: totalCustomers || 892,
      totalDesigns: totalDesigns || 1248,
      customRequestsCount: customRequestsCount || 48,
      recentMessages,
      monthlySales,
      categoryLabels,
      categoryCounts
    });
  } catch (err) {
    next(err);
  }
};
