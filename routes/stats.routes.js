const express = require('express');
const router = express.Router();
const statsController = require('../controllers/stats.controller');
const { protect, admin } = require('../middleware/auth.middleware');

router.get('/lender', protect, statsController.getLenderStats);
router.get('/borrower', protect, statsController.getBorrowerStats);
router.get('/admin', protect, admin, statsController.getAdminStats);

module.exports = router;
