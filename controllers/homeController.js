const Design = require('../models/Design');
const Category = require('../models/Category');
const Order = require('../models/Order');

exports.getHomePage = async (req, res, next) => {
  try {
    const featuredDesigns = await Design.getFeatured(6);
    const newArrivals = await Design.getNewArrivals(6);
    const categories = await Category.getAll();
    const userPurchasedDesignIds = req.user ? await Order.getPurchasedDesignIdsByUser(req.user.id) : [];

    res.render('home', {
      title: 'Aruvi Embroidery | Where Threads Tell Stories',
      featuredDesigns,
      newArrivals,
      categories,
      userPurchasedDesignIds
    });
  } catch (err) {
    next(err);
  }
};
