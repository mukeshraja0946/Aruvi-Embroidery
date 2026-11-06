const Design = require('../models/Design');
const Category = require('../models/Category');
const Order = require('../models/Order');
const Setting = require('../models/Setting');

/**
 * Executes a promise with an isolated timeout and safe fallback.
 * Prevents any single slow query or section from hanging the entire Home page.
 */
function withTimeout(promise, fallback, timeoutMs = 5000, label = 'Section') {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[HomePage Warning] ${label} exceeded ${timeoutMs}ms timeout; rendering page with fallback data.`);
      resolve(fallback);
    }, timeoutMs);
  });

  return Promise.race([
    promise.catch(err => {
      console.warn(`[HomePage Notice] ${label} notice (${err.message}); using fallback.`);
      return fallback;
    }),
    timeoutPromise
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

exports.getHomePage = async (req, res, next) => {
  try {
    const countDisplay = await Setting.get('category_count_display', 'exact');
    const hideEmpty = await Setting.get('category_hide_empty', '0');
    const maxCategoriesOnHome = await Setting.get('max_categories_on_home', '');

    // Fetch all home page sections concurrently with isolated 5-second timeouts
    const [featuredDesigns, newArrivals, categoriesRaw, userPurchasedDesignIds] = await Promise.all([
      withTimeout(Design.getFeatured(6), [], 5000, 'Featured Designs'),
      withTimeout(Design.getNewArrivals(6), [], 5000, 'New Arrivals'),
      withTimeout(Category.getAll({
        status: 'active',
        showOnHomeOnly: true,
        hideEmpty: hideEmpty === '1'
      }), [], 5000, 'Popular Categories'),
      req.user
        ? withTimeout(Order.getPurchasedDesignIdsByUser(req.user.id), [], 3000, 'User Purchased IDs')
        : Promise.resolve([])
    ]);

    let categories = Array.isArray(categoriesRaw) ? categoriesRaw : [];
    if (maxCategoriesOnHome && !isNaN(parseInt(maxCategoriesOnHome, 10)) && parseInt(maxCategoriesOnHome, 10) > 0) {
      categories = categories.slice(0, parseInt(maxCategoriesOnHome, 10));
    }

    res.render('home', {
      title: 'Aruvi Embroidery | Where Threads Tell Stories',
      featuredDesigns: Array.isArray(featuredDesigns) ? featuredDesigns : [],
      newArrivals: Array.isArray(newArrivals) ? newArrivals : [],
      categories,
      countDisplayMode: countDisplay,
      userPurchasedDesignIds: Array.isArray(userPurchasedDesignIds) ? userPurchasedDesignIds : []
    });
  } catch (err) {
    next(err);
  }
};
