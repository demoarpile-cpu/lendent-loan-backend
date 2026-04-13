const express = require('express');
const router = express.Router();
const settingsController = require('../controllers/settings.controller');
const { protect, admin } = require('../middleware/auth.middleware');

// Public route to get settings (needs to be public for registration screen)
router.get('/', settingsController.getSettings);

// Admin only route to update settings
router.post('/update', protect, admin, settingsController.updateSetting);

module.exports = router;
