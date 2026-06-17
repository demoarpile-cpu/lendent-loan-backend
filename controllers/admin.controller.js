const db = require('../config/db');
const { sendMultiChannel } = require('../services/notification.service');

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

        const [users] = await db.execute('SELECT phone, email, one_signal_player_id FROM users WHERE id = ?', [userId]);
        if (users.length > 0) {
            const target = users[0];
            await sendMultiChannel({
                phone: target.phone,
                email: target.email,
                oneSignalPlayerId: target.one_signal_player_id,
                smsBody: 'Your lender account has been approved and is now active.',
                emailSubject: 'Lender Account Approved',
                emailText: 'Your lender account has been approved and is now active.',
                pushTitle: 'Account approved',
                pushBody: 'Your lender account is now active.'
            });
        }

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

        const [users] = await db.execute('SELECT phone, email, one_signal_player_id FROM users WHERE nrc = ? AND role = "borrower" LIMIT 1', [borrower[0].nrc]);
        if (users.length > 0) {
            const target = users[0];
            await sendMultiChannel({
                phone: target.phone,
                email: target.email,
                oneSignalPlayerId: target.one_signal_player_id,
                smsBody: 'Your borrower account has been approved and is now active.',
                emailSubject: 'Borrower Account Approved',
                emailText: 'Your borrower account has been approved and is now active.',
                pushTitle: 'Account approved',
                pushBody: 'Your borrower account is now active.'
            });
        }

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
            (SELECT COUNT(*) FROM default_ledger WHERE nrc = b.nrc) as centralDefaults,
            (SELECT COUNT(*) FROM loan_installments li JOIN loans l ON li.loan_id = l.id WHERE l.borrower_id = b.id AND li.status = 'pending' AND li.due_date < CURRENT_DATE) as missedCount
            FROM borrowers b
            LEFT JOIN users u ON b.nrc = u.nrc AND u.role = 'borrower'
        `);

        // 3. Map risk level
        const formatted = borrowers.map(b => {
            const totalLoans = Number(b.totalLoans) || 0;
            const defaultCount = Number(b.defaultCount) || 0;
            const centralDefaults = Number(b.centralDefaults) || 0;
            const missedCount = Number(b.missedCount) || 0;

            let risk = 'GREEN';
            if (defaultCount > 0 || centralDefaults > 0 || missedCount > 0) risk = 'RED';
            else if (totalLoans > 3) risk = 'AMBER';

            return { ...b, totalLoans, defaultCount: defaultCount + centralDefaults, missedCount, risk };
        });

        res.json(formatted);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.getAllLoans = async (req, res) => {
    try {
        const filterStatus = req.query.status;
        let query = `
            SELECT l.*, b.name as borrowerName, b.nrc as borrowerNrc, 
            u.name as lenderName, u.business_name as lenderBusiness, u.phone as lenderPhone,
            u2.name as createdByName
            FROM loans l
            JOIN borrowers b ON l.borrower_id = b.id
            JOIN users u ON l.lender_id = u.id
            LEFT JOIN users u2 ON l.created_by = u2.id
            WHERE 1=1
        `;

        if (filterStatus) {
            if (filterStatus.toLowerCase() === 'paid') {
                query += ` AND l.status = 'paid'`;
            } else if (filterStatus.toLowerCase() === 'unpaid') {
                query += ` AND l.status = 'active'`;
            } else if (filterStatus.toLowerCase() === 'defaulted') {
                query += ` AND l.status = 'default'`;
            } else if (filterStatus.toLowerCase() === 'late') {
                query += ` AND l.status = 'active' AND EXISTS (
                    SELECT 1 FROM loan_installments li 
                    WHERE li.loan_id = l.id AND li.status IN ('pending', 'missed') AND li.due_date < CURRENT_DATE
                )`;
            }
        }

        query += ` ORDER BY l.created_at DESC`;

        const [loans] = await db.execute(query);

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
            SELECT d.*, b.name as borrowerName, u.name as lenderName, l.amount as loanAmount, l.interest_rate as interestRate
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
        const planType = tier === 'premium' ? 'monthly' : 'free';
        await db.execute('UPDATE users SET membership_tier = ?, plan_type = ? WHERE id = ?', [tier, planType, userId]);

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

        
        if (verificationStatus === 'verified') {
            const [users] = await db.execute('SELECT phone, email, name, one_signal_player_id FROM users WHERE id = ?', [userId]);
            if (users.length > 0) {
                const target = users[0];
                await sendMultiChannel({
                    phone: target.phone,
                    email: target.email,
                    oneSignalPlayerId: target.one_signal_player_id,
                    smsBody: `Hello ${target.name}, your LendaNet account has been verified and is now active!`,
                    emailSubject: 'Account Verified - LendaNet',
                    emailText: `Hello ${target.name},\n\nYour LendaNet account has been successfully verified by the admin and is now active.\n\nYou can now log in and start using the platform.\n\nThank you,\nLendaNet Team`,
                    pushTitle: 'Account Verified',
                    pushBody: 'Your LendaNet account has been verified and is now active!'
                });
            }
        }

        res.json({ message: 'Lender status updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin - Delete Lender (Manually delete all related data to avoid FK issues on any DB)
exports.deleteLender = async (req, res) => {
    try {
        const { id } = req.params;
        const [lenders] = await db.execute('SELECT * FROM users WHERE id = ? AND role = "lender"', [id]);
        
        if (lenders.length === 0) {
            return res.status(404).json({ message: 'Lender not found' });
        }

        const lender = lenders[0];
        const isDeactivated = lender.status === 'deactivated';
        
        if (isDeactivated) {
            // Reactivate
            let newNrc = lender.nrc;
            let newPhone = lender.phone;
            let newEmail = lender.email;
            
            if (newNrc && newNrc.includes('_DEACT_')) newNrc = newNrc.split('_DEACT_')[0];
            if (newPhone && newPhone.includes('_DEACT_')) newPhone = newPhone.split('_DEACT_')[0];
            if (newEmail && newEmail.includes('_DEACT_')) newEmail = newEmail.split('_DEACT_')[0];

            await db.execute(
                'UPDATE users SET status = "active", nrc = ?, phone = ?, email = ? WHERE id = ?',
                [newNrc, newPhone, newEmail, id]
            );
            res.json({ message: 'Lender reactivated successfully' });
        } else {
            // Deactivate
            const suffix = '_DEACT_' + Date.now();
            const newNrc = lender.nrc ? lender.nrc + suffix : null;
            const newPhone = lender.phone ? lender.phone + suffix : null;
            const newEmail = lender.email ? lender.email + suffix : null;

            await db.execute(
                'UPDATE users SET status = "deactivated", nrc = ?, phone = ?, email = ? WHERE id = ?',
                [newNrc, newPhone, newEmail, id]
            );
            res.json({ message: 'Lender deactivated successfully' });
        }
    } catch (error) {
        console.error('Delete/Deactivate Lender Error:', error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
};

exports.deleteBorrower = async (req, res) => {
    try {
        const { id } = req.params;
        const [borrowers] = await db.execute('SELECT * FROM borrowers WHERE id = ?', [id]);
        if (borrowers.length === 0) return res.status(404).json({ message: 'Borrower not found' });

        const borrower = borrowers[0];
        const nrc = borrower.nrc;
        
        // Find corresponding user
        const [users] = await db.execute('SELECT * FROM users WHERE nrc = ? AND role = "borrower"', [nrc]);
        const user = users.length > 0 ? users[0] : null;
        
        const isDeactivated = user && user.status === 'deactivated';

        if (isDeactivated) {
            // Reactivate
            let newNrc = borrower.nrc;
            let newPhone = borrower.phone;
            let newEmail = borrower.email;
            
            if (newNrc && newNrc.includes('_DEACT_')) newNrc = newNrc.split('_DEACT_')[0];
            if (newPhone && newPhone.includes('_DEACT_')) newPhone = newPhone.split('_DEACT_')[0];
            if (newEmail && newEmail.includes('_DEACT_')) newEmail = newEmail.split('_DEACT_')[0];

            await db.execute('UPDATE borrowers SET nrc = ?, phone = ?, email = ? WHERE id = ?', [newNrc, newPhone, newEmail, id]);
            if (user) {
                await db.execute('UPDATE users SET status = "active", nrc = ?, phone = ?, email = ? WHERE id = ?', [newNrc, newPhone, newEmail, user.id]);
            }
            res.json({ message: 'Borrower reactivated successfully' });
        } else {
            // Deactivate
            const suffix = '_DEACT_' + Date.now();
            const newNrc = borrower.nrc ? borrower.nrc + suffix : null;
            const newPhone = borrower.phone ? borrower.phone + suffix : null;
            const newEmail = borrower.email ? borrower.email + suffix : null;

            await db.execute('UPDATE borrowers SET nrc = ?, phone = ?, email = ? WHERE id = ?', [newNrc, newPhone, newEmail, id]);
            if (user) {
                await db.execute('UPDATE users SET status = "deactivated", nrc = ?, phone = ?, email = ? WHERE id = ?', [newNrc, newPhone, newEmail, user.id]);
            }
            res.json({ message: 'Borrower deactivated successfully' });
        }
    } catch (error) {
        console.error('Delete/Deactivate Borrower Error:', error);
        res.status(500).json({ message: error.message || 'Server error' });
    }
};

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

// Admin - Create Loan for a Lender
exports.createLoan = async (req, res) => {
    try {
        const { borrowerId, lenderId, amount, interestRate, installmentsCount, type, issueDate, dueDate } = req.body;

        if (!borrowerId || !lenderId || !amount) {
            return res.status(400).json({ message: 'Borrower, Lender and Amount are required' });
        }

        const finalInterestRate = interestRate || 0;
        const finalInstallmentsCount = installmentsCount || 3;
        const finalIssueDate = issueDate || new Date().toISOString().split('T')[0];

        // Calculate due date if not provided (default to months count)
        let finalDueDate = dueDate;
        if (!finalDueDate) {
            const d = new Date(finalIssueDate);
            d.setMonth(d.getMonth() + finalInstallmentsCount);
            finalDueDate = d.toISOString().split('T')[0];
        }

        // 1. Insert Loan
        const [loanResult] = await db.execute(
            'INSERT INTO loans (lender_id, borrower_id, amount, interest_rate, issue_date, due_date, type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [lenderId, borrowerId, amount, finalInterestRate, finalIssueDate, finalDueDate, type, req.user.id]
        );
        const loanId = loanResult.insertId;

        // 2. Generate Installments
        const totalAmount = parseFloat(amount) + (parseFloat(amount) * (parseFloat(finalInterestRate) / 100));
        const installmentAmount = totalAmount / finalInstallmentsCount;

        for (let i = 1; i <= finalInstallmentsCount; i++) {
            const installmentDueDate = new Date(finalIssueDate);
            installmentDueDate.setMonth(installmentDueDate.getMonth() + i);

            await db.execute(
                'INSERT INTO loan_installments (loan_id, due_date, amount) VALUES (?, ?, ?)',
                [loanId, installmentDueDate, installmentAmount]
            );
        }

        // 3. Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
            ['CREATE_LOAN_ADMIN', req.user.id, `Admin created loan of K${amount} for borrower ${borrowerId} on behalf of lender ${lenderId}`]);

        res.status(201).json({ message: 'Loan created successfully by Admin', loanId });
    } catch (error) {
        console.error('Admin Create Loan Error:', error);
        res.status(500).json({ message: 'Server error creating loan' });
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
        res.json({ message: 'Lender status updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Admin - Delete Lender (Manually delete all related data to avoid FK issues on any DB)
exports.deleteLender = async (req, res) => {
    try {
        const { id } = req.params;

        const [lender] = await db.execute('SELECT * FROM users WHERE id = ? AND role = "lender"', [id]);
        if (lender.length === 0) return res.status(404).json({ message: 'Lender not found' });

        // Audit log before delete
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
            ['DELETE_LENDER', req.user.id, `Deleted lender: ${lender[0].name} (ID: ${id})`]);

        // 1. Get all loan IDs for this lender
        const [loans] = await db.execute('SELECT id FROM loans WHERE lender_id = ?', [id]);
        const loanIds = loans.map(l => l.id);

        if (loanIds.length > 0) {
            const placeholders = loanIds.map(() => '?').join(',');
            // Delete collaterals, payments, installments, default_ledger entries for these loans
            await db.execute(`DELETE FROM collaterals WHERE loan_id IN (${placeholders})`, loanIds);
            await db.execute(`DELETE FROM payments WHERE loan_id IN (${placeholders})`, loanIds);
            await db.execute(`DELETE FROM loan_installments WHERE loan_id IN (${placeholders})`, loanIds);
            await db.execute(`DELETE FROM default_ledger WHERE loan_id IN (${placeholders})`, loanIds);
            // Delete the loans themselves
            await db.execute(`DELETE FROM loans WHERE lender_id = ?`, [id]);
        }

        // 2. Delete lender-borrower junction entries
        await db.execute('DELETE FROM lender_borrowers WHERE lender_id = ?', [id]);

        // 3. Delete referral records
        await db.execute('DELETE FROM referral_rewards WHERE referrer_id = ?', [id]);
        await db.execute('DELETE FROM referrals WHERE referrer_id = ?', [id]);

        // 4. Delete upgrade requests
        await db.execute('DELETE FROM upgrade_requests WHERE user_id = ?', [id]);

        // 5. Delete default_ledger entries by lender_id
        await db.execute('DELETE FROM default_ledger WHERE lender_id = ?', [id]);

        // 6. Finally delete the user record
        await db.execute('DELETE FROM users WHERE id = ?', [id]);

        res.json({ message: 'Lender and all related data deleted successfully' });
    } catch (error) {
        console.error('Delete Lender Error:', error);
        res.status(500).json({ message: error.message || 'Server error deleting lender' });
    }
};

// Admin - Delete Borrower (Manually delete all related data to avoid FK issues on any DB)
exports.deleteBorrower = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Get borrower info
        const [borrower] = await db.execute('SELECT * FROM borrowers WHERE id = ?', [id]);
        if (borrower.length === 0) return res.status(404).json({ message: 'Borrower not found' });

        const nrc = borrower[0].nrc;

        // 2. Audit log before delete
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
            ['DELETE_BORROWER', req.user.id, `Deleted borrower: ${borrower[0].name} (ID: ${id}, NRC: ${nrc})`]);

        // 3. Get all loan IDs for this borrower
        const [loans] = await db.execute('SELECT id FROM loans WHERE borrower_id = ?', [id]);
        const loanIds = loans.map(l => l.id);

        if (loanIds.length > 0) {
            const placeholders = loanIds.map(() => '?').join(',');
            // Delete collaterals, payments, installments, default_ledger entries for these loans
            await db.execute(`DELETE FROM collaterals WHERE loan_id IN (${placeholders})`, loanIds);
            await db.execute(`DELETE FROM payments WHERE loan_id IN (${placeholders})`, loanIds);
            await db.execute(`DELETE FROM loan_installments WHERE loan_id IN (${placeholders})`, loanIds);
            await db.execute(`DELETE FROM default_ledger WHERE loan_id IN (${placeholders})`, loanIds);
            // Delete the loans themselves
            await db.execute(`DELETE FROM loans WHERE borrower_id = ?`, [id]);
        }

        // 4. Delete lender-borrower junction and applications entries
        await db.execute('DELETE FROM loan_applications WHERE borrower_id = ?', [id]);
        await db.execute('DELETE FROM lender_borrowers WHERE borrower_id = ?', [id]);

        // 5. Delete from borrowers table
        await db.execute('DELETE FROM borrowers WHERE id = ?', [id]);

        // 6. Delete associated user record if exists
        if (nrc) {
            await db.execute('DELETE FROM users WHERE nrc = ? AND role = "borrower"', [nrc]);
        }

        res.json({ message: 'Borrower and all related data deleted successfully' });
    } catch (error) {
        console.error('Delete Borrower Error:', error);
        res.status(500).json({ message: error.message || 'Server error deleting borrower' });
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

// Admin - Create Loan for a Lender
exports.createLoan = async (req, res) => {
    try {
        const { borrowerId, lenderId, amount, interestRate, installmentsCount, type, issueDate, dueDate } = req.body;

        if (!borrowerId || !lenderId || !amount) {
            return res.status(400).json({ message: 'Borrower, Lender and Amount are required' });
        }

        const finalInterestRate = interestRate || 0;
        const finalInstallmentsCount = installmentsCount || 3;
        const finalIssueDate = issueDate || new Date().toISOString().split('T')[0];

        // Calculate due date if not provided (default to months count)
        let finalDueDate = dueDate;
        if (!finalDueDate) {
            const d = new Date(finalIssueDate);
            d.setMonth(d.getMonth() + finalInstallmentsCount);
            finalDueDate = d.toISOString().split('T')[0];
        }

        // 1. Insert Loan
        const [loanResult] = await db.execute(
            'INSERT INTO loans (lender_id, borrower_id, amount, interest_rate, issue_date, due_date, type, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [lenderId, borrowerId, amount, finalInterestRate, finalIssueDate, finalDueDate, type, req.user.id]
        );
        const loanId = loanResult.insertId;

        // 2. Generate Installments
        const totalAmount = parseFloat(amount) + (parseFloat(amount) * (parseFloat(finalInterestRate) / 100));
        const installmentAmount = totalAmount / finalInstallmentsCount;

        for (let i = 1; i <= finalInstallmentsCount; i++) {
            const installmentDueDate = new Date(finalIssueDate);
            installmentDueDate.setMonth(installmentDueDate.getMonth() + i);

            await db.execute(
                'INSERT INTO loan_installments (loan_id, due_date, amount) VALUES (?, ?, ?)',
                [loanId, installmentDueDate, installmentAmount]
            );
        }

        // 3. Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)',
            ['CREATE_LOAN_ADMIN', req.user.id, `Admin created loan of K${amount} for borrower ${borrowerId} on behalf of lender ${lenderId}`]);

        res.status(201).json({ message: 'Loan created successfully by Admin', loanId });
    } catch (error) {
        console.error('Admin Create Loan Error:', error);
        res.status(500).json({ message: 'Server error creating loan' });
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

exports.getAllAdmins = async (req, res) => {
    try {
        const [admins] = await db.execute('SELECT id, name, email, phone, role, status, created_at FROM users WHERE role = "admin"');
        res.json(admins);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.addAdmin = async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        const bcrypt = require('bcryptjs');
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length > 0) return res.status(400).json({ message: 'Email already exists' });
        
        const adminPhone = phone || Math.floor(1000000000 + Math.random() * 9000000000).toString();
        await db.execute('INSERT INTO users (name, email, password, phone, role, status, verificationStatus) VALUES (?, ?, ?, ?, "admin", "active", "verified")', [name, email, hashedPassword, adminPhone]);
        res.status(201).json({ message: 'Admin added successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.deleteAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const [admins] = await db.execute('SELECT id FROM users WHERE role = "admin"');
        if (admins.length <= 1) return res.status(400).json({ message: 'Cannot delete the only admin' });
        
        await db.execute('DELETE FROM users WHERE id = ? AND role = "admin"', [id]);
        res.json({ message: 'Admin deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateAdminEmail = async (req, res) => {
    try {
        const { id } = req.params;
        const { email } = req.body;
        
        const [existing] = await db.execute('SELECT id FROM users WHERE email = ? AND id != ?', [email, id]);
        if (existing.length > 0) return res.status(400).json({ message: 'Email already exists' });
        
        await db.execute('UPDATE users SET email = ? WHERE id = ? AND role = "admin"', [email, id]);
        res.json({ message: 'Admin email updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

exports.updateAdminPhone = async (req, res) => {
    try {
        const { id } = req.params;
        const { phone } = req.body;
        
        await db.execute('UPDATE users SET phone = ? WHERE id = ? AND role = "admin"', [phone, id]);
        res.json({ message: 'Admin phone updated successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
