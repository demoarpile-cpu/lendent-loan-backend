const db = require('../config/db');

// Add or Reuse Borrower
exports.addBorrower = async (req, res) => {
    try {
        const { name, nrc, email, phone, dob } = req.body;
        let photoUrl = null;
        let nrcUrl = null;
        if (req.files) {
            const photoFile = req.files.find(f => f.fieldname === 'photo');
            if (photoFile) photoUrl = `/uploads/${photoFile.filename}`;
            const nrcFile = req.files.find(f => f.fieldname === 'nrc_document');
            if (nrcFile) nrcUrl = `/uploads/${nrcFile.filename}`;
        } else if (req.file) {
            photoUrl = `/uploads/${req.file.filename}`;
        }
        const lenderId = req.user.id; // From JWT

        // 1. Check if borrower exists by NRC
        let [existing] = await db.execute('SELECT * FROM borrowers WHERE nrc = ?', [nrc]);

        if (existing.length > 0) {
            const borrower = existing[0];
            
            // 2. Check if already linked to this lender
            const [link] = await db.execute(
                'SELECT * FROM lender_borrowers WHERE lender_id = ? AND borrower_id = ?',
                [lenderId, borrower.id]
            );

            if (link.length > 0) {
                return res.status(200).json({ 
                    message: 'Borrower already exists in your ledger.',
                    borrower_id: borrower.id
                });
            }

            // 3. Return confirmation request
            return res.status(200).json({
                exists: true,
                message: 'Borrower already exists. Please confirm before adding.',
                borrower: {
                    id: borrower.id,
                    name: borrower.name,
                    date_of_birth: borrower.dob,
                    profile_picture: borrower.photo_url
                }
            });
        }

        // 4. Create new borrower (if not exists)
        const [result] = await db.execute(
            'INSERT INTO borrowers (name, nrc, email, phone, dob, photo_url, nrc_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, nrc, email || null, phone, dob || null, photoUrl, nrcUrl]
        );
        const borrowerId = result.insertId;

        // 5. Link to lender immediately for new borrowers
        await db.execute(
            'INSERT INTO lender_borrowers (lender_id, borrower_id) VALUES (?, ?)',
            [lenderId, borrowerId]
        );

        res.status(201).json({
            message: 'Borrower created and added to your ledger.',
            borrowerId
        });
    } catch (error) {
        console.error('Add Borrower Error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            const field = error.sqlMessage.includes('email') ? 'Email'
                        : error.sqlMessage.includes('nrc') ? 'NRC'
                        : error.sqlMessage.includes('phone') ? 'Phone' : 'Entry';
            return res.status(400).json({ message: `${field} already exists. Please use a different ${field.toLowerCase()}.` });
        }
        res.status(500).json({ message: 'Server error adding borrower' });
    }
};

// Confirm and Attach Existing Borrower to Lender Ledger
exports.confirmAddBorrower = async (req, res) => {
    try {
        const { borrower_id } = req.body;
        const lenderId = req.user.id;

        if (!borrower_id) {
            return res.status(400).json({ message: 'Borrower ID is required' });
        }

        // Check if borrower exists
        const [borrower] = await db.execute('SELECT * FROM borrowers WHERE id = ?', [borrower_id]);
        if (borrower.length === 0) {
            return res.status(404).json({ message: 'Borrower not found' });
        }

        // Link to lender (using INSERT IGNORE to prevent duplicates)
        await db.execute(
            'INSERT IGNORE INTO lender_borrowers (lender_id, borrower_id) VALUES (?, ?)',
            [lenderId, borrower_id]
        );

        res.json({
            message: 'Borrower successfully attached to your ledger.',
            borrower_id
        });
    } catch (error) {
        console.error('Confirm Add Borrower Error:', error);
        res.status(500).json({ message: 'Server error confirming borrower addition' });
    }
};

// Get All Borrowers for a Lender
exports.getLenderBorrowers = async (req, res) => {
    try {
        const lenderId = req.user.id;
        
        // 1. Get threshold
        const [settings] = await db.execute('SELECT setting_value FROM system_settings WHERE setting_key = "default_threshold"');
        const threshold = settings.length > 0 ? parseInt(settings[0].setting_value) : 3;

        // 2. Query with aggregates
        const [borrowers] = await db.execute(
            `SELECT b.*,
             (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id) as totalLoans,
             (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id AND status = 'default') as totalDefaults,
             (SELECT COUNT(*) FROM loan_installments li JOIN loans l ON li.loan_id = l.id WHERE l.borrower_id = b.id AND li.status = 'pending' AND li.due_date < CURRENT_DATE) as missedCount
             FROM borrowers b 
             JOIN lender_borrowers lb ON b.id = lb.borrower_id 
             WHERE lb.lender_id = ?`,
            [lenderId]
        );

        // 3. User info for membership check
        const [user] = await db.execute('SELECT membership_tier FROM users WHERE id = ?', [lenderId]);
        const isFree = user[0].membership_tier === 'free';

        // 4. Map risk and filter sensitive data
        const formatted = borrowers.map(b => {
             // 4. Calculate Dynamic Credit Score (800 - 1400)
             let score = 1400;
             score -= (b.totalDefaults * 150);
             score -= (b.missedCount * 100);
             score -= (b.totalLoans * 10); // Slight reduction for exposure
             
             // Ensure score floor
             if (score < 800) score = 800;

             // Map Risk Level
             let risk = 'GREEN';
             if (score < 1000) risk = 'RED';
             else if (score < 1200) risk = 'AMBER';
             
             const result = { ...b, risk, score };
             
             // If free tier, hide risk level if required (though user said free user can add/manage borrowers)
             // But user also said "Restrict: Risk score, Advanced data, Default ledger"
             // For THEIR OWN borrowers, maybe they should see it?
             // "Free plan me sirf ye allowed hona chahiye: Borrowers add & manage, Loan create & track, Loan mark as repaid/defaulted"
             // Let's keep risk level for their own borrowers but maybe hide from others?
             // Actually, the user's specific request was: "Free user ko bhi Risk levels / Default ledger Sab dikh raha hai (jo nahi dikhna chahiye)"
             if (isFree) {
                 result.risk = 'HIDDEN';
                 result.totalDefaults = 'HIDDEN';
             }

             return result;
        });

        res.json(formatted);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching borrowers' });
    }
};

// Get Borrower Risk Summary (Restricted)
exports.getRiskSummary = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Get borrower info
        const [borrower] = await db.execute('SELECT * FROM borrowers WHERE id = ?', [id]);
        if (borrower.length === 0) return res.status(404).json({ message: 'Borrower not found' });

        // 2. Get loan stats
        const [stats] = await db.execute(
            `SELECT 
                COUNT(*) as totalLoans,
                SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeLoans,
                SUM(CASE WHEN status = 'default' THEN 1 ELSE 0 END) as defaultCount
             FROM loans WHERE borrower_id = ?`,
            [id]
        );

        // 3. Check membership & relationship
        const lenderId = req.user.id;
        const [user] = await db.execute('SELECT membership_tier FROM users WHERE id = ?', [lenderId]);
        const isFree = user[0].membership_tier === 'free';
        
        const [relation] = await db.execute('SELECT id FROM lender_borrowers WHERE lender_id = ? AND borrower_id = ?', [lenderId, id]);
        const hasRelation = relation.length > 0;

        // 4. Score-Based Risk Engine (800 - 1400)
        const [missed] = await db.execute(
            `SELECT COUNT(*) as missedCount FROM loan_installments li
             JOIN loans l ON li.loan_id = l.id
             WHERE l.borrower_id = ? AND li.status = 'pending' AND li.due_date < CURRENT_DATE`,
            [id]
        );
        const missedCount = missed[0].missedCount;

        let score = 1400;
        score -= (stats[0].defaultCount * 150);
        score -= (missedCount * 100);
        score -= (stats[0].totalLoans * 10);
        if (score < 800) score = 800;

        let riskLevel = 'Green';
        if (score < 1000) riskLevel = 'Red';
        else if (score < 1200) riskLevel = 'Amber';

        const response = {
            borrower: {
                ...borrower[0],
                phone: hasRelation ? borrower[0].phone : '********',
                email: hasRelation ? borrower[0].email : '********',
                dob: hasRelation ? borrower[0].dob : '********'
            }
        };

        if (isFree && !hasRelation) {
            response.riskLevel = 'HIDDEN';
            response.isRestricted = true;
            response.message = 'Upgrade to Premium to view risk data.';
        } else {
            response.riskLevel = riskLevel;
            response.creditScore = score;
            response.totalLoans = stats[0].totalLoans;
            response.activeLoans = stats[0].activeLoans;
            response.defaultCount = stats[0].defaultCount;
        }

        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
const bcrypt = require('bcryptjs');

// Enable login for a borrower
exports.enableLogin = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Get borrower info
        const [borrower] = await db.execute('SELECT * FROM borrowers WHERE id = ?', [id]);
        if (borrower.length === 0) return res.status(404).json({ message: 'Borrower not found' });
        
        const b = borrower[0];

        // 2. Check if user already exists
        const [existing] = await db.execute('SELECT * FROM users WHERE phone = ? OR nrc = ?', [b.phone, b.nrc]);
        if (existing.length > 0) {
            return res.status(400).json({ message: 'Login is already enabled for this borrower' });
        }

        // 3. Generate random password
        const plainPassword = 'LN@' + Math.floor(100000 + Math.random() * 899999);
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        // 4. Generate referral code
        const referralCode = b.name.substring(0, 3).toUpperCase() + Math.floor(1000 + Math.random() * 9000);

        // 5. Create user record
        await db.execute(
            'INSERT INTO users (name, phone, email, nrc, password, role, status, verificationStatus, referral_code) VALUES (?, ?, ?, ?, ?, "borrower", "active", "verified", ?)',
            [b.name, b.phone, b.email || null, b.nrc, hashedPassword, referralCode]
        );

        // In a real app, send SMS here. For now, we return it.
        res.json({
            message: 'Login enabled successfully',
            credentials: {
                phone: b.phone,
                password: plainPassword
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error enabling login' });
    }
};
// Update Borrower
exports.updateBorrower = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, email, dob } = req.body;
        
        await db.execute(
            'UPDATE borrowers SET name = ?, phone = ?, email = ?, dob = ? WHERE id = ?',
            [name, phone, email || null, dob || null, id]
        );

        res.json({ message: 'Borrower updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error updating borrower' });
    }
};

// Delete Borrower
exports.deleteBorrower = async (req, res) => {
    try {
        const { id } = req.params;
        const lenderId = req.user.id;

        // 1. Remove link from lender_borrowers
        await db.execute(
            'DELETE FROM lender_borrowers WHERE lender_id = ? AND borrower_id = ?',
            [lenderId, id]
        );

        res.json({ message: 'Borrower removed from your list' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error deleting borrower' });
    }
};
