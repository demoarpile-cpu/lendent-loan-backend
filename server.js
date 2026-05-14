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

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'http://localhost:3000',
    'http://localhost:3001',
    'https://zanezion.kiaansoftware.com',
    'https://loanmanagements.kiaansoftware.com',
    'https://www.lendanet.com',
    'https://lendanet.com',
    'https://lendanet.vercel.app',
    'https://www.lendanet.vercel.app',
];

// Add environment-based frontend URLs if specified
if (process.env.FRONTEND_URL) {
    let frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl.startsWith('http')) {
        allowedOrigins.push(`http://${frontendUrl}`);
        allowedOrigins.push(`https://${frontendUrl}`);
    } else {
        allowedOrigins.push(frontendUrl);
    }
}

app.use(cors({
    origin: function (origin, callback) {
        // allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn('CORS request from unauthorized origin:', origin);
            // Instead of returning an error (which causes a 500 status), 
            // return false to signify the origin is not allowed.
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 3600
}));

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
const contactRoutes = require('./routes/contact.routes');

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
app.use('/api/contact', contactRoutes);

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 404 Handler
app.use((req, res) => {
    console.warn(`[404] Route not found: ${req.method} ${req.url}`);
    res.status(404).json({ message: `Route ${req.url} not found` });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error('SERVER ERROR:', err.stack);
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ message: 'Unexpected field in form data', field: err.field });
    }
    res.status(500).json({ message: err.message || 'Internal Server Error' });
});

// Global Exception Handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    
    // Auto-migrate database schema
    try {
        const { syncSchema } = require('./config/schemaSync');
        await syncSchema();
    } catch (e) {
        console.error('[DB-SYNC] Critical error during schema sync:', e.message);
    }

    // Ensure collateral_upload_enabled setting exists in DB
    try {
        const db = require('./config/db');
        await db.query("INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('collateral_upload_enabled', 'true')");
    } catch (e) { console.log('Settings seed skipped:', e.message); }
});
