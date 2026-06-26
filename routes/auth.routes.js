const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const multer = require('multer');
const path = require('path');

// Multer config for license uploads - using stable disk storage
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage });

const { protect } = require('../middleware/auth.middleware');

const rateLimit = require('express-rate-limit');

// Define rate limiter: 5 requests per 1 hour
const loginLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // Limit each IP to 5 login requests per window (1 hour)
    message: { message: "Too many failed login attempts. For your security, your IP has been temporarily blocked from logging in. Please try again after 1 hour." },
    standardHeaders: true, 
    legacyHeaders: false, 
});

router.post('/register', upload.any(), authController.register);
router.post('/login', loginLimiter, authController.login);
router.get('/me', protect, authController.getMe);
router.post('/verify-otp', authController.verifyOtp);
router.post('/push-player-id', protect, authController.savePushPlayerId);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/request-reactivation', authController.requestReactivation);
router.put('/update-profile', protect, upload.any(), authController.updateProfile);

module.exports = router;
