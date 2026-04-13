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

router.post('/register', upload.any(), authController.register);
router.post('/login', authController.login);
router.get('/me', protect, authController.getMe);
router.post('/verify-otp', authController.verifyOtp);
router.put('/update-profile', protect, authController.updateProfile);

module.exports = router;
