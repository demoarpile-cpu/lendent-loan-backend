const db = require('../config/db');

exports.getLenderStats = async (req, res) => {
    try {
        const lenderId = req.user.id;

        // Total Portfolio & Active/Default counts
        const [counts] = await db.execute(`
            SELECT 
                COALESCE(SUM(amount), 0) as totalPortfolio,
                COUNT(*) as totalLoans,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeLoans,
                SUM(CASE WHEN status = 'default' THEN 1 ELSE 0 END) as defaultedLoans
            FROM loans 
            WHERE lender_id = ?
        `, [lenderId]);

        // Recent Activity
        const [recent] = await db.execute(`
            SELECT l.*, b.name as borrowerName 
            FROM loans l
            JOIN borrowers b ON l.borrower_id = b.id
            WHERE l.lender_id = ?
            ORDER BY l.created_at DESC
            LIMIT 5
        `, [lenderId]);

        res.json({
            ...counts[0],
            recentActivity: recent
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAdminStats = async (req, res) => {
    try {
        // Total Capital
        const [capital] = await db.execute(`SELECT SUM(amount) as totalCapital FROM loans`);
        
        // Lender counts
        const [lenders] = await db.execute(`
            SELECT 
                COUNT(*) as totalLenders,
                SUM(CASE WHEN isPaid = 0 THEN 1 ELSE 0 END) as freeLenders,
                SUM(CASE WHEN isPaid = 1 THEN 1 ELSE 0 END) as premiumLenders
            FROM users 
            WHERE role = 'lender'
        `);

        // Recent Audit Logs
        const [logs] = await db.execute(`
            SELECT a.*, u.name as performedBy 
            FROM audit_logs a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.created_at DESC 
            LIMIT 5
        `);

        res.json({
            totalCapital: capital[0].totalCapital || 0,
            ...lenders[0],
            recentLogs: logs
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
exports.getBorrowerStats = async (req, res) => {
    try {
        const borrowerId = req.user.id;
        
        // 1. Get borrower record id (from borrowers table matching users table nrc)
        const [user] = await db.execute('SELECT nrc FROM users WHERE id = ?', [borrowerId]);
        if (!user[0].nrc) return res.status(404).json({ message: 'Borrower record not found' });
        
        const [borrowerRecord] = await db.execute('SELECT id, dob, photo_url, nrc_url FROM borrowers WHERE nrc = ?', [user[0].nrc]);
        if (borrowerRecord.length === 0) return res.json({ totalPortfolio: 0, activeLoans: 0, defaultedLoans: 0, recentActivity: [] });

        const bId = borrowerRecord[0].id;

        // 2. Stats
        const [counts] = await db.execute(`
            SELECT 
                COALESCE(SUM(amount), 0) as totalDebt,
                COUNT(*) as totalLoans,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeLoans,
                SUM(CASE WHEN status = 'default' THEN 1 ELSE 0 END) as defaultedLoans
            FROM loans 
            WHERE borrower_id = ?
        `, [bId]);

        // 3. Recent Activity (Loans)
        const [recent] = await db.execute(`
            SELECT l.*, u.name as lenderName 
            FROM loans l
            JOIN users u ON l.lender_id = u.id
            WHERE l.borrower_id = ?
            ORDER BY l.created_at DESC
            LIMIT 5
        `, [bId]);

        // 4. Calculate Risk & Score (800 - 1400)
        const [missed] = await db.execute(
            `SELECT COUNT(*) as missedCount FROM loan_installments li
             JOIN loans l ON li.loan_id = l.id
             WHERE l.borrower_id = ? AND li.status = 'pending' AND li.due_date < CURRENT_DATE`,
            [bId]
        );
        const missedCount = missed[0].missedCount;

        let score = 1400;
        score -= (counts[0].defaultedLoans * 150);
        score -= (missedCount * 100);
        score -= (counts[0].totalLoans * 10);
        if (score < 800) score = 800;

        let riskLevel = 'GREEN';
        if (score < 1000) riskLevel = 'RED';
        else if (score < 1200) riskLevel = 'AMBER';

        res.json({
            ...counts[0],
            risk: riskLevel,
            score: score,
            recentActivity: recent,
            profile: {
                dob: borrowerRecord[0].dob,
                photo_url: borrowerRecord[0].photo_url,
                nrc_url: borrowerRecord[0].nrc_url
            }
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
