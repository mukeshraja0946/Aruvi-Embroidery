const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Standard Auth Routes
router.get('/auth/login', authController.getLogin);
router.post('/auth/login', authController.postLogin);
router.get('/auth/register', authController.getRegister);
router.post('/auth/register', authController.postRegister);
router.get('/auth/forgot-password', authController.getForgotPassword);
router.post('/auth/forgot-password', authController.postForgotPassword);
router.get('/auth/logout', authController.logout);

// Google Auth Routes (Customer Login Only)
router.post('/auth/google/verify', authController.postGoogleVerify);
router.get('/auth/google', authController.getGoogleAuth);
router.get('/auth/google/callback', authController.getGoogleCallback);

// Route Aliases as requested
router.get('/login', authController.getLogin);
router.post('/login', authController.postLogin);
router.get('/register', authController.getRegister);
router.post('/register', authController.postRegister);
router.get('/logout', authController.logout);

module.exports = router;
