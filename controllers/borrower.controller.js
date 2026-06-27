const db = require('../config/db');
const bcrypt = require('bcryptjs');

// Add or Reuse Borrower
exports.addBorrower = async (req, res) => {
    try {
        const { name, nrc, email, phone, dob, password } = req.body;
        let photoUrl = null;
        let nrcUrl = null;

        if (req.files) {
            const photoFile = req.files.find(f => f.fieldname === 'photo');
            if (photoFile) photoUrl = `/uploads/${photoFile.filename}`;
            const nrcFile = req.files.find(f => f.fieldname === 'nrc_document');
            if (nrcFile) nrcUrl = `/uploads/${nrcFile.filename}`;
        }
        const lenderId = req.user.id;

        // 1. Check if borrower exists by NRC in users table first (to handle deactivated accounts system-wide)
        let [existingU_check] = await db.execute('SELECT id, name, status FROM users WHERE nrc = ?', [nrc]);
        if (existingU_check.length > 0) {
            const userStatus = existingU_check[0].status;
            if (userStatus === 'deactivated') {
                return res.status(409).json({ 
                    message: 'Account Deactivated',
                    isDeactivatedNrc: true,
                    existingBorrower: existingU_check[0]
                });
            }
        }

        // 1b. Check if borrower exists in borrowers table by NRC
        let [existingB] = await db.execute('SELECT id, name, nrc, verificationStatus FROM borrowers WHERE nrc = ?', [nrc]);
        if (existingB.length > 0) {
            return res.status(409).json({ 
                message: `NRC ${nrc} is already registered on the network.`,
                existingBorrower: existingB[0]
            });
        }

        // 1bb. Check if phone is already used by any user (Lender or Borrower) in users table
        const [existingUserPhone] = await db.execute('SELECT id, role, name FROM users WHERE phone = ?', [phone]);
        if (existingUserPhone.length > 0) {
            return res.status(409).json({ 
                message: `This phone number is already registered to a ${existingUserPhone[0].role} account (${existingUserPhone[0].name}). Please use a different phone number.` 
            });
        }

        // 1c. Check if borrower exists in borrowers table by Phone or Email
        let bContactQuery = 'SELECT * FROM borrowers WHERE phone = ?';
        let bContactParams = [phone];
        if (email && email.trim() !== '') {
            bContactQuery += ' OR email = ?';
            bContactParams.push(email);
        }
        let [existingBContact] = await db.execute(bContactQuery, bContactParams);
        
        if (existingBContact.length > 0) {
            const dupBPhone = existingBContact.find(b => b.phone === phone);
            if (dupBPhone) return res.status(409).json({ message: 'The phone number is already registered to another borrower.' });
            return res.status(409).json({ message: 'The email address is already registered to another borrower.' });
        }

        // 2. Insert into borrowers table
        const [result] = await db.execute(
            'INSERT INTO borrowers (name, nrc, email, phone, dob, photo_url, nrc_url, verificationStatus) VALUES (?, ?, ?, ?, ?, ?, ?, "pending")',
            [name, nrc, email || null, phone, dob || null, photoUrl, nrcUrl]
        );
        const borrowerId = result.insertId;

        // 3. Create User Account if password is provided or auto-generate one
        let finalPassword = password;
        if (!finalPassword) {
            // Auto-generate a strong random password that meets criteria (Uppercase, Lowercase, Special, Min 8 chars)
            finalPassword = 'Ln@' + Math.floor(100000 + Math.random() * 899999);
        }
        
        const hashedPassword = await bcrypt.hash(finalPassword, 10);
        const referralCode = name.substring(0, 3).toUpperCase() + Math.floor(1000 + Math.random() * 9000);

        // Check if user already exists (by phone, email or NRC)
        let uQuery = 'SELECT * FROM users WHERE phone = ? OR nrc = ?';
        let uParams = [phone, nrc];
        if (email && email.trim() !== '') {
            uQuery += ' OR email = ?';
            uParams.push(email);
        }
        const [existingU] = await db.execute(uQuery, uParams);

        if (existingU.length > 0) {
            const otherUserPhone = existingU.find(u => u.phone === phone && u.nrc !== nrc);
            if (otherUserPhone) {
                return res.status(409).json({ message: `The phone number is already registered to another account.` });
            }
            const otherUserEmail = existingU.find(u => email && u.email === email && u.nrc !== nrc);
            if (otherUserEmail) {
                return res.status(409).json({ message: `The email address is already registered to another account.` });
            }
        }

        if (existingU.length === 0) {
            await db.execute(
                'INSERT INTO users (name, phone, email, nrc, password, role, status, verificationStatus, referral_code, profile_image_url, license_url) VALUES (?, ?, ?, ?, ?, "borrower", "active", "verified", ?, ?, ?)',
                [name, phone, email || null, nrc, hashedPassword, referralCode, photoUrl, nrcUrl]
            );

            // Send Welcome/Credentials Notification
            const notificationService = require('../services/notification.service');
            const welcomeMsg = `Your Lendanet account has been successfully registered using the following details:\nUsername: ${phone}\nTemporary Password: ${finalPassword}\n\nPlease use the following link (https://lendanet.com/login) and click forgot password to create a new password as soon as possible for security reasons.`;
            
            await notificationService.sendMultiChannel({
                phone,
                email: email || null,
                smsBody: welcomeMsg,
                emailSubject: 'LendaNet Account Created',
                emailText: welcomeMsg
            });
        }


        // 4. Link to lender
        await db.execute(
            'INSERT IGNORE INTO lender_borrowers (lender_id, borrower_id) VALUES (?, ?)',
            [lenderId, borrowerId]
        );

        res.status(201).json({
            message: 'Borrower created and added to your ledger.',
            borrowerId,
            plainPassword: finalPassword
        });
    } catch (error) {
        console.error('Add Borrower Error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            const errStr = error.message.toLowerCase();
            if (errStr.includes('phone')) return res.status(409).json({ message: 'The phone number is already in use.' });
            if (errStr.includes('email')) return res.status(409).json({ message: 'The email address is already in use.' });
            return res.status(409).json({ message: 'This phone number or email is already registered.' });
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

        // 2. Query with aggregates, excluding deactivated borrowers
        const [borrowers] = await db.execute(
            `SELECT b.*,
             (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id) as totalLoans,
             (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id AND status = 'default') as totalDefaults,
             (SELECT COUNT(*) FROM default_ledger WHERE nrc = b.nrc) as centralDefaults,
             (SELECT COUNT(*) FROM loan_installments li JOIN loans l ON li.loan_id = l.id WHERE l.borrower_id = b.id AND li.status = 'pending' AND li.due_date < CURRENT_DATE) as missedCount
             FROM borrowers b 
             JOIN lender_borrowers lb ON b.id = lb.borrower_id 
             LEFT JOIN users u ON b.nrc = u.nrc
             WHERE lb.lender_id = ? AND (u.status IS NULL OR u.status != 'deactivated')
             AND (b.nrc IS NULL OR b.nrc NOT LIKE '%_DEACT_%')`,
            [lenderId]
        );

        // 3. User info for membership check
        const [user] = await db.execute('SELECT membership_tier FROM users WHERE id = ?', [lenderId]);
        const isFree = user[0].membership_tier === 'free';

        // 4. Map risk and filter sensitive data
        const formatted = borrowers.map(b => {
             let risk = 'GREEN';
             if (Number(b.totalLoans) === 0) risk = 'GREEN';
             else if (b.totalDefaults > 0 || b.centralDefaults > 0 || b.missedCount > 0) risk = 'RED';
             else if (b.totalLoans > 5) risk = 'AMBER';
             
             const result = { ...b, risk };
             
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

        let riskLevel = 'GREEN';
        // Check central defaults by NRC
        const [central] = await db.execute('SELECT COUNT(*) as count FROM default_ledger WHERE nrc = ?', [borrower[0].nrc]);
        const totalDefaults = (stats[0].defaultCount || 0) + (central[0].count || 0);

        if (Number(stats[0].totalLoans) === 0) riskLevel = 'GREEN';
        else if (totalDefaults > 0 || missedCount > 0) riskLevel = 'RED';
        else if (stats[0].totalLoans > 5) riskLevel = 'AMBER';

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

// Enable login for a borrower

exports.enableLogin = async (req, res) => {
    try {
        const { id } = req.params;
        
        // 1. Get borrower info
        const [borrower] = await db.execute('SELECT * FROM borrowers WHERE id = ?', [id]);
        if (borrower.length === 0) return res.status(404).json({ message: 'Borrower not found' });
        
        const b = borrower[0];

        // 2. Generate random password that meets criteria (Uppercase, Lowercase, Special, Min 8 chars)
        const plainPassword = 'Ln@' + Math.floor(100000 + Math.random() * 899999);
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        // 3. Check if user already exists
        const [existing] = await db.execute('SELECT id, nrc, role FROM users WHERE phone = ? OR nrc = ?', [b.phone, b.nrc]);

        if (existing.length > 0) {
            const otherUserPhone = existing.find(u => u.phone === b.phone);
            if (otherUserPhone) {
                return res.status(409).json({ message: `The phone number is associated with a ${otherUserPhone.role} account (${otherUserPhone.name || 'someone else'}). Please update the borrower's phone number before enabling login.` });
            }
        }
        
        // Clean phone and email of _DEACT_ suffix if present
        let cleanPhone = b.phone || '';
        let cleanEmail = b.email || '';
        if (cleanPhone && cleanPhone.includes('_DEACT_')) cleanPhone = cleanPhone.split('_DEACT_')[0];
        if (cleanEmail && cleanEmail.includes('_DEACT_')) cleanEmail = cleanEmail.split('_DEACT_')[0];

        let messageText = '';
        let messageSubject = '';
        let isDeactivated = b.nrc && b.nrc.includes('_DEACT_');

        if (isDeactivated) {
            messageSubject = 'LendaNet Account Status';
            messageText = `Dear ${b.name}, your LendaNet account has been deactivated by the administrator. Please contact support for more information.`;
            
            // Send Credentials Notification
            const notificationService = require('../services/notification.service');
            await notificationService.sendMultiChannel({
                phone: cleanPhone,
                email: cleanEmail,
                smsBody: messageText,
                emailSubject: messageSubject,
                emailText: messageText
            });

            return res.json({
                message: 'Deactivation notice sent successfully.',
                credentials: {
                    phone: cleanPhone,
                    password: 'ACCOUNT DEACTIVATED'
                }
            });
        }

        if (existing.length > 0) {
            // Admin requested resend: Update password to a newly generated one
            await db.execute('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, existing[0].id]);
            messageSubject = 'LendaNet Login Credentials Resent';
            messageText = `Your LendaNet account credentials have been reset by the Admin.\nUsername: ${cleanPhone}\nNew Temporary Password: ${plainPassword}\n\nPlease log in at https://lendanet.com/login and change your password immediately.`;
        } else {
            // 4. Generate referral code and create new user record
            const referralCode = b.name.substring(0, 3).toUpperCase() + Math.floor(1000 + Math.random() * 9000);
            await db.execute(
                'INSERT INTO users (name, phone, email, nrc, password, role, status, verificationStatus, referral_code) VALUES (?, ?, ?, ?, ?, "borrower", "active", "verified", ?)',
                [b.name, cleanPhone, cleanEmail || null, b.nrc, hashedPassword, referralCode]
            );
            messageSubject = 'LendaNet Login Enabled';
            messageText = `Your Lendanet account has been successfully registered using the following details:\nUsername: ${cleanPhone}\nTemporary Password: ${plainPassword}\n\nPlease use the following link (https://lendanet.com/login) and click forgot password to create a new password as soon as possible for security reasons.`;
        }

        // Send Credentials Notification
        const notificationService = require('../services/notification.service');
        
        await notificationService.sendMultiChannel({
            phone: cleanPhone,
            email: cleanEmail,
            smsBody: messageText,
            emailSubject: messageSubject,
            emailText: messageText
        });

        res.json({
            message: 'Credentials sent successfully.',
            credentials: {
                phone: cleanPhone,
                password: existing.length > 0 ? 'Use registered password' : plainPassword
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
        const { name, phone, email, dob, nrc, password } = req.body;
        
        // 1. Get current borrower info
        const [current] = await db.execute('SELECT nrc FROM borrowers WHERE id = ?', [id]);
        if (current.length === 0) return res.status(404).json({ message: 'Borrower not found' });
        const oldNrc = current[0].nrc;

        if (phone || email) {
            let uUpdateQuery = 'SELECT * FROM users WHERE phone = ? AND nrc != ?';
            let uUpdateParams = [phone || '', oldNrc];
            if (email && email.trim() !== '') {
                uUpdateQuery = 'SELECT * FROM users WHERE (phone = ? OR email = ?) AND nrc != ?';
                uUpdateParams = [phone || '', email, oldNrc];
            }
            const [existingU] = await db.execute(uUpdateQuery, uUpdateParams);
            
            if (existingU.length > 0) {
                const dupPhone = existingU.find(u => u.phone === phone);
                if (dupPhone) {
                    return res.status(409).json({ message: 'Phone number is already in use by another account.' });
                }
                return res.status(409).json({ message: 'Email address is already in use by another account.' });
            }
        }

        let photoUrl = null;
        let nrcUrl = null;

        if (req.files) {
            const photoFile = req.files.find(f => f.fieldname === 'photo');
            if (photoFile) photoUrl = `/uploads/${photoFile.filename}`;
            const nrcFile = req.files.find(f => f.fieldname === 'nrc_document');
            if (nrcFile) nrcUrl = `/uploads/${nrcFile.filename}`;
        }

        const updates = [];
        const params = [];

        if (name) { updates.push('name = ?'); params.push(name); }
        if (phone) { updates.push('phone = ?'); params.push(phone); }
        if (email) { updates.push('email = ?'); params.push(email); }
        if (dob) { updates.push('dob = ?'); params.push(dob); }
        if (nrc) { updates.push('nrc = ?'); params.push(nrc); }
        if (photoUrl) { updates.push('photo_url = ?'); params.push(photoUrl); }
        if (nrcUrl) { updates.push('nrc_url = ?'); params.push(nrcUrl); }

        if (updates.length > 0) {
            params.push(id);
            await db.execute(`UPDATE borrowers SET ${updates.join(', ')} WHERE id = ?`, params);
        }

        // 2. Sync with Users table (if account exists)
        const [userExists] = await db.execute('SELECT id FROM users WHERE nrc = ? AND role = "borrower"', [oldNrc]);
        if (userExists.length > 0) {
            const userId = userExists[0].id;
            const userUpdates = [];
            const userParams = [];

            if (name) { userUpdates.push('name = ?'); userParams.push(name); }
            if (phone) { userUpdates.push('phone = ?'); userParams.push(phone); }
            if (email) { userUpdates.push('email = ?'); userParams.push(email); }
            if (nrc) { userUpdates.push('nrc = ?'); userParams.push(nrc); }
            if (photoUrl) { userUpdates.push('profile_image_url = ?'); userParams.push(photoUrl); }
            if (nrcUrl) { userUpdates.push('license_url = ?'); userParams.push(nrcUrl); }

            if (userUpdates.length > 0) {
                userParams.push(userId);
                await db.execute(`UPDATE users SET ${userUpdates.join(', ')} WHERE id = ?`, userParams);
            }
        }

        res.json({ message: 'Borrower and associated user account updated successfully' });
    } catch (error) {
        console.error('Update Borrower Error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Email or Phone number is already in use by another account.' });
        }
        res.status(500).json({ message: 'Server error updating borrower', error: error.message, stack: error.stack });
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
