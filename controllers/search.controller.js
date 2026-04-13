const db = require('../config/db');

// Search Borrower by NRC or Phone
exports.searchBorrower = async (req, res) => {
    try {
        const q = req.query.q?.trim();
        if (!q) return res.status(400).json({ message: 'Search query is required' });

        // Extract only digits from query
        const digitsOnly = q.replace(/\D/g, '');
        // Get last 9 digits for phone matching (handles 0977xxx, +260977xxx, 260977xxx, 977xxx)
        const last9 = digitsOnly.length >= 9 ? digitsOnly.slice(-9) : digitsOnly;
        const originalPattern = `%${q}%`;

        console.log('Search query:', q, '| Digits:', digitsOnly, '| Last9:', last9);

        // 1. Search in borrowers table by NRC or phone (last 9 digits match)
        let borrowerQuery = 'SELECT * FROM borrowers WHERE nrc LIKE ? OR phone LIKE ?';
        let borrowerParams = [originalPattern, originalPattern];
        if (last9.length >= 6) {
            borrowerQuery += ' OR RIGHT(REPLACE(REPLACE(REPLACE(phone, " ", ""), "-", ""), "+", ""), 9) = ?';
            borrowerParams.push(last9);
        }
        const [borrowers] = await db.query(borrowerQuery, borrowerParams);
        console.log('Borrower results:', borrowers.length);

        // 2. Search in users table for lenders
        let lenderQuery = `SELECT id, name, phone, email, nrc, business_name, lender_type, lender_id, plan_type, role
             FROM users WHERE role = 'lender' AND (nrc LIKE ? OR phone LIKE ? OR business_name LIKE ? OR lender_id LIKE ?`;
        let lenderParams = [originalPattern, originalPattern, originalPattern, originalPattern];
        if (last9.length >= 6) {
            lenderQuery += ' OR RIGHT(REPLACE(REPLACE(REPLACE(phone, " ", ""), "-", ""), "+", ""), 9) = ?';
            lenderParams.push(last9);
        }
        lenderQuery += ')';
        const [lenders] = await db.query(lenderQuery, lenderParams);
        console.log('Lender results:', lenders.length);

        if (borrowers.length === 0 && lenders.length === 0) {
            return res.status(404).json({ message: 'No borrower or lender found with this NRC or Phone' });
        }

        // If ONLY lenders found (no borrower match), return lender results
        if (borrowers.length === 0 && lenders.length > 0) {
            return res.json({
                type: 'lender',
                results: lenders.map(l => ({
                    id: l.id, name: l.name, nrc: l.nrc, phone: l.phone, email: l.email,
                    business_name: l.business_name, lender_type: l.lender_type,
                    lender_id: l.lender_id, type: 'lender'
                }))
            });
        }

        // Borrower found — return borrower profile with risk data
        const borrower = borrowers[0];
        const lenderId = req.user.id;

        const [relation] = await db.execute(
            'SELECT * FROM lender_borrowers WHERE lender_id = ? AND borrower_id = ?',
            [lenderId, borrower.id]
        );
        const hasRelation = relation.length > 0;

        const [userRow] = await db.execute('SELECT membership_tier, isPaid FROM users WHERE id = ?', [lenderId]);
        const isFree = userRow[0].membership_tier === 'free';

        // Mask phone safely
        let maskedPhone = borrower.phone || 'N/A';
        if (!hasRelation && borrower.phone && borrower.phone.length >= 8) {
            maskedPhone = borrower.phone.substring(0, 4) + 'XXXX' + borrower.phone.substring(borrower.phone.length - 2);
        }

        const response = {
            id: borrower.id,
            name: borrower.name,
            nrc: borrower.nrc,
            dob: borrower.dob || null,
            phone: hasRelation ? (borrower.phone || 'N/A') : maskedPhone,
            photo_url: borrower.photo_url,
            hasRelation
        };

        if (isFree && !hasRelation) {
            response.isRestricted = true;
            response.message = "Upgrade to Premium to view risk profile and default history for this borrower.";
        } else {
            // Loan stats
            const [stats] = await db.execute(
                `SELECT
                    COUNT(*) as totalLoans,
                    SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeLoans,
                    SUM(CASE WHEN status = 'default' THEN 1 ELSE 0 END) as defaultCount,
                    SUM(CASE WHEN type = 'Collateral' THEN 1 ELSE 0 END) as collateralCount,
                    SUM(CASE WHEN type = 'Non' THEN 1 ELSE 0 END) as nonCollateralCount,
                    SUM(CASE WHEN type = 'Guarantor' THEN 1 ELSE 0 END) as guarantorCount
                 FROM loans WHERE borrower_id = ?`,
                [borrower.id]
            );

            // Late/overdue installments count
            const [lateRows] = await db.execute(
                `SELECT COUNT(*) as lateCount FROM loan_installments li
                 JOIN loans l ON li.loan_id = l.id
                 WHERE l.borrower_id = ? AND li.status = 'pending' AND li.due_date < CURRENT_DATE`,
                [borrower.id]
            );

            response.risk_status = stats[0].defaultCount > 0 ? 'RED' : (stats[0].activeLoans > 0 ? 'AMBER' : 'GREEN');
            response.activeLoans = stats[0].activeLoans;
            response.total_defaults = stats[0].defaultCount;
            response.lateCount = lateRows[0].lateCount;
            response.loanTypes = {
                collateral: stats[0].collateralCount,
                nonCollateral: stats[0].nonCollateralCount,
                guarantor: stats[0].guarantorCount
            };

            // Default records with loan type and collateral details
            const [defaults] = await db.execute(
                `SELECT d.*, l.type as loan_type, l.amount as loan_amount
                 FROM default_ledger d
                 LEFT JOIN loans l ON d.loan_id = l.id
                 WHERE d.nrc = ?`,
                [borrower.nrc]
            );

            // Fetch collateral details for collateral-type defaults
            for (const def of defaults) {
                if (def.loan_type === 'Collateral') {
                    const [cols] = await db.execute(
                        'SELECT file_url, description FROM collaterals WHERE loan_id = ?',
                        [def.loan_id]
                    );
                    def.collaterals = cols;
                }
            }

            response.defaults = defaults;
        }

        res.json(response);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
