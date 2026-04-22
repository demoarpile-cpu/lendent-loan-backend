const express = require('express');
const router = express.Router();
const contactController = require('../controllers/contact.controller');
const { protect, admin } = require('../middleware/auth.middleware');

// Public route to submit a contact message
router.post('/', contactController.submitMessage);

// Admin routes to view and manage messages
router.get('/', protect, admin, contactController.getMessages);
router.put('/:id/read', protect, admin, contactController.markAsRead);

module.exports = router;
