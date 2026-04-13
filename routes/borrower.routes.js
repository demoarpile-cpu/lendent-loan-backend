const express = require('express');
const router = express.Router();
const borrowerController = require('../controllers/borrower.controller');
const { protect } = require('../middleware/auth.middleware');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

router.post('/', protect, upload.any(), borrowerController.addBorrower);
router.post('/confirm-add', protect, borrowerController.confirmAddBorrower);
router.get('/', protect, borrowerController.getLenderBorrowers);
router.post('/:id/enable-login', protect, borrowerController.enableLogin);
router.get('/:id/risk', protect, borrowerController.getRiskSummary);
router.put('/:id', protect, borrowerController.updateBorrower);
router.delete('/:id', protect, borrowerController.deleteBorrower);

module.exports = router;
