const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect, admin } = require('../middleware/auth.middleware');

router.get('/lenders', protect, admin, adminController.getPendingLenders);
router.post('/approve-lender', protect, admin, adminController.approveLender);
router.get('/defaults', protect, admin, adminController.getDefaults);
router.post('/remove-default', protect, admin, adminController.removeDefault);
router.get('/borrowers', protect, admin, adminController.getAllBorrowers);
router.post('/approve-borrower', protect, admin, adminController.approveBorrower);
router.get('/loans', protect, admin, adminController.getAllLoans);
router.get('/audit-logs', protect, admin, adminController.getAuditLogs);
router.get('/referrals', protect, admin, adminController.getReferrals);
router.get('/membership-plans', protect, admin, adminController.getMembershipPlans);
router.post('/membership-plans/:id', protect, admin, adminController.updateMembershipPlan);
router.get('/settings', protect, admin, adminController.getSettings);
router.post('/settings', protect, admin, adminController.updateSetting);
router.post('/update-membership', protect, admin, adminController.updateMembership);
router.post('/update-lender-status', protect, admin, adminController.updateLenderStatus);
router.get('/lender/:id', protect, admin, adminController.getLenderDetails);
router.get('/lender/:id/loans', protect, admin, adminController.getLenderLoans);
router.get('/lenders/:id/loans', protect, admin, adminController.getLenderLoans);
router.delete('/lenders/:id', protect, admin, adminController.deleteLender);

module.exports = router;
