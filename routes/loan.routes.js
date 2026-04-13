const express = require('express');
const router = express.Router();
const loanController = require('../controllers/loan.controller');
const { protect } = require('../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, 'collateral_' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

router.post('/', protect, loanController.createLoan);
router.get('/', protect, loanController.getLoans);
router.post('/:id/payment', protect, loanController.addPayment);
router.post('/:id/reverse-payment', protect, loanController.reversePayment);
router.post('/:id/undo-paid', protect, loanController.undoMarkAsPaid);
router.put('/:id/default', protect, loanController.markDefault);
router.post('/:id/collateral', protect, upload.array('files', 5), loanController.uploadCollateral);
router.get('/:id/collateral', protect, loanController.getCollaterals);

router.get('/my-loans', protect, loanController.getMyLoans);
router.get('/lender-defaults', protect, loanController.getLenderDefaults);

module.exports = router;
