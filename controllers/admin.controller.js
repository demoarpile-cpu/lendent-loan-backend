const db = require('../config/db');

exports.getPendingLenders = async (req, res) => {
    try {
        const [lenders] = await db.execute('SELECT * FROM users WHERE role = "lender"');
        res.json(lenders);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.approveLender = async (req, res) => {
    try {
        const { userId } = req.body;
        await db.execute('UPDATE users SET verificationStatus = "verified", status = "active", membership_tier = "free" WHERE id = ?', [userId]);
        
        // Add audit log
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
            ['APPROVE_LENDER', req.user.id, `Approved lender ID: ${userId}`]);

        res.json({ message: 'Lender approved successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.approveBorrower = async (req, res) => {
    try {
        const { borrowerId } = req.body;
        // 1. Get borrower info to find NRC
        const [borrower] = await db.execute('SELECT nrc FROM borrowers WHERE id = ?', [borrowerId]);
        if (borrower.length === 0) return res.status(404).json({ message: 'Borrower not found' });
        
        // 2. Update user status via NRC
        await db.execute('UPDATE users SET verificationStatus = "verified", status = "active" WHERE nrc = ? AND role = "borrower"', [borrower[0].nrc]);
        
        // 3. Update borrower profile verification
        await db.execute('UPDATE borrowers SET verificationStatus = "verified" WHERE id = ?', [borrowerId]);
        
        // Add audit log
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
            ['APPROVE_BORROWER', req.user.id, `Approved borrower ID: ${borrowerId}`]);

        res.json({ message: 'Borrower approved successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllBorrowers = async (req, res) => {
    try {
        // 1. Get threshold
        const [settings] = await db.execute('SELECT setting_value FROM system_settings WHERE setting_key = "default_threshold"');
        const threshold = settings.length > 0 ? parseInt(settings[0].setting_value) : 3;

        // 2. Main query
        const [borrowers] = await db.execute(`
            SELECT b.*, 
            u.status as userStatus,
            u.verificationStatus as userVerification,
            u.membership_tier as membershipTier,
            u.id as user_id,
            (SELECT GROUP_CONCAT(u2.name SEPARATOR ', ') FROM lender_borrowers lb JOIN users u2 ON lb.lender_id = u2.id WHERE lb.borrower_id = b.id) as lenderName,
            (SELECT GROUP_CONCAT(lb.lender_id SEPARATOR ',') FROM lender_borrowers lb WHERE lb.borrower_id = b.id) as lenderIds,
            (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id) as totalLoans,
            (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id AND status = 'default') as defaultCount,
            (SELECT COUNT(*) FROM loan_installments li JOIN loans l ON li.loan_id = l.id WHERE l.borrower_id = b.id AND li.status = 'pending' AND li.due_date < CURRENT_DATE) as missedCount
            FROM borrowers b
            LEFT JOIN users u ON b.nrc = u.nrc AND u.role = 'borrower'
        `);

        // 3. Map risk level using score (800 - 1400)
        const formatted = borrowers.map(b => {
            let score = 1400;
            score -= (b.defaultCount * 150);
            score -= (b.missedCount * 100);
            score -= (b.totalLoans * 10);
            if (score < 800) score = 800;

            let risk = 'GREEN';
            if (score < 1000) risk = 'RED';
            else if (score < 1200) risk = 'AMBER';
            
            return { ...b, risk, score };
        });

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllLoans = async (req, res) => {
    try {
        const [loans] = await db.execute(`
            SELECT l.*, b.name as borrowerName, b.nrc as borrowerNrc, 
            u.name as lenderName, u.business_name as lenderBusiness, u.phone as lenderPhone,
            u2.name as createdByName
            FROM loans l
            JOIN borrowers b ON l.borrower_id = b.id
            JOIN users u ON l.lender_id = u.id
            LEFT JOIN users u2 ON l.created_by = u2.id
            ORDER BY l.created_at DESC
        `);

        // Fetch installments for each loan
        for (let loan of loans) {
            const [installments] = await db.execute(
                'SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY due_date ASC',
                [loan.id]
            );
            loan.instalmentSchedule = installments;
        }

        res.json(loans);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getDefaults = async (req, res) => {
    try {
        const [defaults] = await db.execute(`
            SELECT d.*, b.name as borrowerName, u.name as lenderName, l.amount as loanAmount
            FROM default_ledger d
            JOIN loans l ON d.loan_id = l.id
            JOIN borrowers b ON l.borrower_id = b.id
            JOIN users u ON d.lender_id = u.id
        `);
        res.json(defaults);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin - Remove Default
exports.removeDefault = async (req, res) => {
    try {
        const id = req.params.id || req.body.id || req.body.loanId;
        if (!id) return res.status(400).json({ message: 'Default ID is required' });
        const [ledger] = await db.execute('SELECT loan_id FROM default_ledger WHERE id = ?', [id]);
        if (ledger.length === 0) return res.status(404).json({ message: 'Default record not found' });

        await db.execute('UPDATE loans SET status = "active" WHERE id = ?', [ledger[0].loan_id]);
        await db.execute('DELETE FROM default_ledger WHERE id = ?', [id]);

        res.json({ message: 'Default removed and loan restored' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin - Get Audit Logs
exports.getAuditLogs = async (req, res) => {
    try {
        const [logs] = await db.execute(`
            SELECT a.*, u.name as userName 
            FROM audit_logs a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.created_at DESC
        `);
        res.json(logs);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin - Get All Referrals
exports.getReferrals = async (req, res) => {
    try {
        const [referrals] = await db.execute(`
            SELECT r.*, 
            u1.name as referrerName, 
            u2.name as referredName,
            rw.amount as bonus
            FROM referrals r
            JOIN users u1 ON r.referrer_id = u1.id
            JOIN users u2 ON r.referred_user_id = u2.id
            LEFT JOIN referral_rewards rw ON r.id = rw.referral_id
            ORDER BY r.created_at DESC
        `);
        res.json(referrals);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin - Get Membership Plans
exports.getMembershipPlans = async (req, res) => {
    try {
        const [plans] = await db.execute('SELECT * FROM membership_plans');
        res.json(plans);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin - Update Membership Plan
exports.updateMembershipPlan = async (req, res) => {
    try {
        const { id } = req.params;
        const { price, duration_days } = req.body;
        await db.execute('UPDATE membership_plans SET price = ?, duration_days = ? WHERE id = ?', 
            [price, duration_days, id]);
        res.json({ message: 'Membership plan updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin - Get Settings
exports.getSettings = async (req, res) => {
    try {
        const [settings] = await db.execute('SELECT * FROM system_settings');
        res.json(settings);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Admin - Update Setting
exports.updateSetting = async (req, res) => {
    try {
        const { key, value } = req.body;
        await db.execute('UPDATE system_settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
        
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
            ['UPDATE_SETTING', req.user.id, `Updated setting ${key} to: ${value}`]);

        res.json({ message: 'Setting updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin - Update Membership Tier
exports.updateMembership = async (req, res) => {
    try {
        const { userId, tier } = req.body;
        await db.execute('UPDATE users SET membership_tier = ? WHERE id = ?', [tier, userId]);
        
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
            ['UPDATE_MEMBERSHIP', req.user.id, `Updated user ${userId} to tier: ${tier}`]);

        res.json({ message: 'Membership tier updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin - Update Lender Status (Approve/Reject)
exports.updateLenderStatus = async (req, res) => {
    try {
        const { userId, status, verificationStatus } = req.body;
        await db.execute('UPDATE users SET status = ?, verificationStatus = ? WHERE id = ?', 
            [status, verificationStatus, userId]);
        
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
            ['UPDATE_LENDER_STATUS', req.user.id, `Updated lender ${userId} to ${status}/${verificationStatus}`]);

        res.json({ message: 'Lender status updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin - Delete Lender (ON DELETE CASCADE handles all related data automatically)
exports.deleteLender = async (req, res) => {
    try {
        const { id } = req.params;

        const [lender] = await db.execute('SELECT * FROM users WHERE id = ? AND role = "lender"', [id]);
        if (lender.length === 0) return res.status(404).json({ message: 'Lender not found' });

        // Audit log before delete (since user_id will be SET NULL after cascade)
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
            ['DELETE_LENDER', req.user.id, `Deleted lender: ${lender[0].name} (ID: ${id})`]);

        // Just delete user - CASCADE will auto-remove all related data
        await db.execute('DELETE FROM users WHERE id = ?', [id]);

        res.json({ message: 'Lender deleted successfully' });
    } catch (error) {
        console.error('Delete Lender Error:', error);
        res.status(500).json({ message: 'Server error deleting lender' });
    }
};

// Admin - Get Single Lender Details
// Get all loans for a specific lender (Admin view)
exports.getLenderLoans = async (req, res) => {
    try {
        const { id } = req.params;
        const [loans] = await db.execute(
            `SELECT l.*, b.name as borrowerName, b.nrc as borrowerNRC
             FROM loans l
             JOIN borrowers b ON l.borrower_id = b.id
             WHERE l.lender_id = ?
             ORDER BY l.created_at DESC`,
            [id]
        );

        for (let loan of loans) {
            const [installments] = await db.execute(
                'SELECT * FROM loan_installments WHERE loan_id = ? ORDER BY due_date ASC',
                [loan.id]
            );
            loan.instalmentSchedule = installments;
        }

        res.json(loans);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getLenderDetails = async (req, res) => {
    try {
        const { id } = req.params;
        const [lenders] = await db.execute('SELECT id, lender_id, name, phone, email, nrc, company_registration_number, business_name, lender_type, plan_type, license_url, nrc_url, role, status, verificationStatus, membership_tier, created_at FROM users WHERE id = ? AND role = "lender"', [id]);
        
        if (lenders.length === 0) {
            return res.status(404).json({ message: 'Lender not found' });
        }
        res.json(lenders[0]);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
