const express = require('express');
const router = express.Router();
const referralController = require('../controllers/referral.controller');
const { protect } = require('../middleware/auth.middleware');

router.get('/stats', protect, referralController.getStats);
router.post('/check', protect, referralController.checkQualification);

module.exports = router;
