const express = require('express');
const router = express.Router();
const searchController = require('../controllers/search.controller');
const { protect } = require('../middleware/auth.middleware');
const checkMembership = require('../middleware/membership.middleware');

router.get('/', protect, checkMembership, searchController.searchBorrower);

module.exports = router;
