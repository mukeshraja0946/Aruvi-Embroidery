const Design = require('../models/Design');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Setting = require('../models/Setting');

exports.getHomePage = async (req, res, next) => {
  try {
    const featuredDesigns = await Design.getFeatured(6);
    const newArrivals = await Design.getNewArrivals(6);

    const countDisplay = await Setting.get('category_count_display', 'exact');
    const hideEmpty = await Setting.get('category_hide_empty', '0');
    const maxCategoriesOnHome = await Setting.get('max_categories_on_home', '');

    let categories = await Category.getAll({
      status: 'active',
      showOnHomeOnly: true,
      hideEmpty: hideEmpty === '1'
    });

    if (maxCategoriesOnHome && !isNaN(parseInt(maxCategoriesOnHome, 10)) && parseInt(maxCategoriesOnHome, 10) > 0) {
      categories = categories.slice(0, parseInt(maxCategoriesOnHome, 10));
    }

    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];

    res.render('home', {
      title: 'Aruvi Embroidery | Where Threads Tell Stories',
      featuredDesigns,
      newArrivals,
      categories,
      countDisplayMode: countDisplay,
      userPurchasedDesignIds
    });
  } catch (err) {
    next(err);
  }
};
