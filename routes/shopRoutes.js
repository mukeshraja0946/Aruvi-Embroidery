const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shopController');

// Designs listing page
router.get('/shop', shopController.getShopPage);
router.get('/designs', shopController.getShopPage);

// Categories listing page & individual category page
router.get('/categories', shopController.getCategoriesPage);
router.get('/category/:id', shopController.getCategoryDetailPage);

const userController = require('../controllers/userController');

// Product detail page & API
router.get('/design/:slug', shopController.getDesignDetail);
router.get('/api/designs/:designId/download', userController.downloadDesignApi);
router.get('/api/customer/designs/:designId/download', userController.downloadDesignApi);
router.get('/api/designs/:id', shopController.getDesignApi);

// Review submission
router.post('/review/add', shopController.postReview);

module.exports = router;
