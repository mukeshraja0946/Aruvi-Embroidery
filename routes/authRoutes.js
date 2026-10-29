const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

const { strictLimiter } = require('../middleware/rateLimiters');

// Standard Auth Routes
router.get('/auth/login', authController.getLogin);
router.post('/auth/login', strictLimiter, authController.postLogin);
router.get('/auth/register', authController.getRegister);
router.post('/auth/register', strictLimiter, authController.postRegister);
router.get('/auth/forgot-password', authController.getForgotPassword);
router.post('/auth/forgot-password', strictLimiter, authController.postForgotPassword);
router.get('/auth/logout', authController.logout);

// Google Auth Routes (Customer Login Only)
router.post('/auth/google/verify', strictLimiter, authController.postGoogleVerify);
router.get('/auth/google', authController.getGoogleAuth);
router.get('/auth/google/callback', authController.getGoogleCallback);

// Route Aliases as requested
router.get('/login', authController.getLogin);
router.post('/login', strictLimiter, authController.postLogin);
router.get('/register', authController.getRegister);
router.post('/register', strictLimiter, authController.postRegister);
router.get('/logout', authController.logout);

module.exports = router;
