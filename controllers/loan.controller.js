const db = require('../config/db');

// Create Loan and Generate Installments
exports.createLoan = async (req, res) => {
    try {
        const { borrowerId, borrower_id, amount, interestRate, interest_rate, issueDate, issue_date, dueDate, due_date, type, installmentsCount, installments, guarantorName, guarantorPhone, guarantorNrc, lender_id, admin_override } = req.body;
        // Admin can specify a different lender_id; normal lenders use their own id
        const lenderId = (admin_override && lender_id) ? lender_id : req.user.id;
        const finalBorrowerId = borrowerId || borrower_id;
        const finalAmount = amount;
        const finalInterestRate = interestRate || interest_rate || 0;
        const finalIssueDate = issueDate || issue_date || new Date().toISOString().split('T')[0];
        const finalDueDate = dueDate || due_date;
        const finalInstallmentsCount = installmentsCount || installments || 3;

        // 1. Insert Loan
        const [loanResult] = await db.execute(
            'INSERT INTO loans (lender_id, borrower_id, amount, interest_rate, issue_date, due_date, type, guarantor_name, guarantor_phone, guarantor_nrc, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [lenderId, finalBorrowerId, finalAmount, finalInterestRate, finalIssueDate, finalDueDate, type, guarantorName || null, guarantorPhone || null, guarantorNrc || null, req.user.id]
        );
        const loanId = loanResult.insertId;

        // 2. Generate Installments (Simple Monthly Breakdown)
        const totalAmount = parseFloat(finalAmount) + (parseFloat(finalAmount) * (parseFloat(finalInterestRate) / 100));
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
        await db.execute('INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
            ['CREATE_LOAN', req.user.id, 'loan', loanId, `Loan of K${finalAmount} created for borrower ID: ${finalBorrowerId}`]);

        res.status(201).json({ message: 'Loan created and installments generated', loanId });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error creating loan' });
    }
};

// Add Payment
exports.addPayment = async (req, res) => {
    try {
        const { id } = req.params; // Loan ID
        const { amount, method, installmentId } = req.body;

        // 1. Add Payment Record
        await db.execute(
            'INSERT INTO payments (loan_id, installment_id, amount, method) VALUES (?, ?, ?, ?)',
            [id, installmentId || null, amount, method]
        );

        // 2. Update Installment Status if applicable
        if (installmentId) {
            await db.execute(
                'UPDATE loan_installments SET status = "paid", paid_amount = paid_amount + ?, paid_at = CURRENT_TIMESTAMP WHERE id = ?',
                [amount, installmentId]
            );
        }

        // 3. Check if all paid → update loan status
        const [unpaid] = await db.execute('SELECT id FROM loan_installments WHERE loan_id = ? AND status = "pending"', [id]);
        if (unpaid.length === 0) {
            await db.execute('UPDATE loans SET status = "paid" WHERE id = ?', [id]);
        }

        // 4. Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', 
            ['ADD_PAYMENT', req.user.id, 'loan', id, `Payment of K${amount} added for loan ID: ${id}`]);

        res.json({ message: 'Payment added successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Undo Mark As Paid
exports.undoMarkAsPaid = async (req, res) => {
    try {
        const { id } = req.params; // Loan ID
        
        // 1. Update loan status back to active
        await db.execute('UPDATE loans SET status = "active" WHERE id = ?', [id]);

        // 2. Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', 
            ['UNDO_MARK_PAID', req.user.id, 'loan', id, `Undo 'paid' status for loan ID: ${id}`]);

        res.json({ message: 'Loan status reverted to active' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error reverting status' });
    }
};

// Reverse Payment for a specific installment
exports.reversePayment = async (req, res) => {
    try {
        const { id } = req.params; // Loan ID
        const { installmentId } = req.body;

        console.log(`[REVERSE] Reversing payment for Loan: ${id}, Installment: ${installmentId}`);

        if (!installmentId) {
            return res.status(400).json({ message: 'Installment ID is required' });
        }

        // 1. Delete payment records for this installment
        const [delResult] = await db.execute(
            'DELETE FROM payments WHERE loan_id = ? AND installment_id = ?',
            [id, installmentId]
        );
        console.log(`[REVERSE] Deleted ${delResult.affectedRows} payment records`);

        // 2. Reset installment status
        const [insResult] = await db.execute(
            'UPDATE loan_installments SET status = "pending", paid_amount = 0, paid_at = NULL WHERE id = ?',
            [installmentId]
        );
        console.log(`[REVERSE] Updated ${insResult.affectedRows} installment record to pending`);

        // 3. Set loan status back to active (if it was paid or default)
        const [loanResult] = await db.execute('UPDATE loans SET status = "active" WHERE id = ?', [id]);
        console.log(`[REVERSE] Reverted loan status to active (ID: ${id})`);

        // 4. Remove from default ledger (in case it was there)
        await db.execute('DELETE FROM default_ledger WHERE loan_id = ?', [id]);
        console.log(`[REVERSE] Removed loan from default ledger (if applicable)`);

        // 5. Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', 
            ['REVERSE_PAYMENT', req.user.id, 'loan', id, `Payment reversed for installment ID: ${installmentId}`]);

        res.json({ message: 'Payment reversed successfully', installmentId });
    } catch (error) {
        console.error('[REVERSE ERROR]', error);
        res.status(500).json({ message: 'Server error reversing payment' });
    }
};

// Mark Default (Logic: Based on configured system threshold)
exports.markDefault = async (req, res) => {
    try {
        const { id } = req.params; // Loan ID
        
        // 1. Mark as default
        await db.execute('UPDATE loans SET status = "default" WHERE id = ?', [id]);

        // 3. Add to shared ledger
        const [loanInfo] = await db.execute(
            'SELECT l.amount, b.nrc, l.lender_id FROM loans l JOIN borrowers b ON l.borrower_id = b.id WHERE l.id = ?', 
            [id]
        );
        
        await db.execute(
            'INSERT INTO default_ledger (nrc, loan_id, lender_id, amount) VALUES (?, ?, ?, ?)',
            [loanInfo[0].nrc, id, loanInfo[0].lender_id, loanInfo[0].amount]
        );

        // 4. Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)', 
            ['MARK_DEFAULT', req.user.id, 'loan', id, `Loan ID: ${id} marked as default`]);

        res.json({ message: 'Loan marked as default and added to shared ledger' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Upload Collateral Documents for a Loan
exports.uploadCollateral = async (req, res) => {
    try {
        const { id } = req.params; // Loan ID
        const { description } = req.body;

        // Check if collateral uploads are enabled
        const [setting] = await db.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'collateral_upload_enabled'");
        if (setting.length > 0 && setting[0].setting_value === 'false') {
            return res.status(403).json({ message: 'Collateral uploads are currently disabled by admin' });
        }

        // Verify loan exists and belongs to this lender
        const [loan] = await db.execute('SELECT * FROM loans WHERE id = ? AND lender_id = ?', [id, req.user.id]);
        if (loan.length === 0) return res.status(404).json({ message: 'Loan not found' });

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ message: 'At least one file is required' });
        }

        const uploaded = [];
        for (const file of req.files) {
            const fileUrl = `/uploads/${file.filename}`;
            await db.execute(
                'INSERT INTO collaterals (loan_id, file_url, description) VALUES (?, ?, ?)',
                [id, fileUrl, description || null]
            );
            uploaded.push({ file_url: fileUrl, description });
        }

        // Audit log
        await db.execute('INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
            ['UPLOAD_COLLATERAL', req.user.id, 'loan', id, `${uploaded.length} collateral file(s) uploaded for loan ID: ${id}`]);

        res.status(201).json({ message: `${uploaded.length} collateral document(s) uploaded`, collaterals: uploaded });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error uploading collateral' });
    }
};

// Get Collateral Documents for a Loan
exports.getCollaterals = async (req, res) => {
    try {
        const { id } = req.params;
        const [collaterals] = await db.execute('SELECT * FROM collaterals WHERE loan_id = ?', [id]);
        res.json(collaterals);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Auto-check and mark loans as default if missed EMIs >= threshold
async function autoMarkDefaults(lenderId) {
    try {
        // Get threshold from settings
        const [settings] = await db.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'default_threshold'");
        const threshold = settings.length > 0 ? parseInt(settings[0].setting_value) : 3;

        // Find active loans with missed installments >= threshold
        const [eligibleLoans] = await db.execute(
            `SELECT l.id, l.borrower_id, l.amount, l.lender_id, b.nrc,
                (SELECT COUNT(*) FROM loan_installments li
                 WHERE li.loan_id = l.id AND li.status = 'pending' AND li.due_date < CURRENT_DATE) as missedCount
             FROM loans l
             JOIN borrowers b ON l.borrower_id = b.id
             WHERE l.lender_id = ? AND l.status = 'active'
             HAVING missedCount >= ?`,
            [lenderId, threshold]
        );

        for (const loan of eligibleLoans) {
            // Mark as default
            await db.execute('UPDATE loans SET status = "default" WHERE id = ?', [loan.id]);

            // Add to shared default ledger
            await db.execute(
                'INSERT INTO default_ledger (nrc, loan_id, lender_id, amount) VALUES (?, ?, ?, ?)',
                [loan.nrc, loan.id, loan.lender_id, loan.amount]
            );

            // Audit log
            await db.execute(
                'INSERT INTO audit_logs (action, user_id, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
                ['AUTO_DEFAULT', lenderId, 'loan', loan.id, `Loan ID: ${loan.id} auto-marked as default (${loan.missedCount} missed EMIs, threshold: ${threshold})`]
            );
        }

        return eligibleLoans.length;
    } catch (error) {
        console.error('Auto-default check error:', error);
        return 0;
    }
}

// Get All Loans (for dashboard/filter)
exports.getLoans = async (req, res) => {
    try {
        const lenderId = req.user.id;

        // Auto-check defaults before returning loans
        await autoMarkDefaults(lenderId);

        const [loans] = await db.execute(
            `SELECT l.*, b.name as borrowerName, b.nrc as borrowerNRC
             FROM loans l
             JOIN borrowers b ON l.borrower_id = b.id
             WHERE l.lender_id = ?`,
            [lenderId]
        );

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
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Get Lender specific defaults
exports.getLenderDefaults = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const [defaults] = await db.execute(
            `SELECT 
                d.id, 
                d.amount as defaultAmount, 
                d.default_date as defaultDate, 
                d.loan_id as loanId, 
                d.nrc as borrowerNRC,
                b.name as borrowerName, 
                u.name as lenderName,
                'active' as status
             FROM default_ledger d 
             JOIN borrowers b ON d.nrc = b.nrc 
             JOIN users u ON d.lender_id = u.id`
        );
        res.json(defaults);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching defaults' });
    }
};

// Get My Loans (for borrower)
exports.getMyLoans = async (req, res) => {
    try {
        const userId = req.user.id;
        const [user] = await db.execute('SELECT nrc FROM users WHERE id = ?', [userId]);
        const [borrowerRecord] = await db.execute('SELECT id FROM borrowers WHERE nrc = ?', [user[0].nrc]);
        
        if (borrowerRecord.length === 0) return res.json([]);

        const [loans] = await db.execute(
            `SELECT l.*, u.name as lenderName, u.phone as lenderPhone, u.email as lenderEmail, u.business_name as lenderBusiness
             FROM loans l
             JOIN users u ON l.lender_id = u.id
             WHERE l.borrower_id = ?`,
            [borrowerRecord[0].id]
        );

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
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
