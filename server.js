const dotenv = require('dotenv');
const result = dotenv.config();
if (result.error) {
    console.error('CRITICAL: .env file fail to load!', result.error);
} else {
    console.log('SUCCESS: Environment Variables Injected from .env');
}

const express = require('express');
const cors = require('cors');
const path = require('path');

const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Debug Logging
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    if (req.method === 'POST') console.log('Body:', req.body);
    next();
});

// Import Routes
const authRoutes = require('./routes/auth.routes');
const borrowerRoutes = require('./routes/borrower.routes');
const loanRoutes = require('./routes/loan.routes');
const searchRoutes = require('./routes/search.routes');
const referralRoutes = require('./routes/referral.routes');
const adminRoutes = require('./routes/admin.routes');
const statsRoutes = require('./routes/stats.routes');
const settingsRoutes = require('./routes/settings.routes');
const membershipRoutes = require('./routes/membership.routes');

// Route Middlewares
app.use('/api/auth', authRoutes);
app.use('/api/borrowers', borrowerRoutes);
app.use('/api/loans', loanRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/stats', statsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/membership', membershipRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Error Handler
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err);
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Unexpected field in form data', field: err.field });
    }
    res.status(500).json({ message: err.message || 'Internal Server Error' });
});

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    // Ensure collateral_upload_enabled setting exists in DB
    try {
        const db = require('./config/db');
        await db.query("INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('collateral_upload_enabled', 'true')");
    } catch (e) { console.log('Settings seed skipped:', e.message); }
});
