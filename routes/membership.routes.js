const express = require('express');
const router = express.Router();
const membershipController = require('../controllers/membership.controller');
const { protect, admin } = require('../middleware/auth.middleware');

router.get('/plans', membershipController.getPlans); // Public - needed for pricing display
router.post('/upgrade', protect, membershipController.requestUpgrade);

// Admin only
router.get('/requests', protect, admin, membershipController.getUpgradeRequests);
router.post('/handle-request', protect, admin, membershipController.handleUpgradeRequest);

module.exports = router;
