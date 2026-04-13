const db = require('../config/db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// Password strength validation helper
function validatePassword(password) {
    const errors = [];
    if (password.length < 8) errors.push('at least 8 characters');
    if (!/[A-Z]/.test(password)) errors.push('one uppercase letter');
    if (!/[a-z]/.test(password)) errors.push('one lowercase letter');
    if (!/[0-9]/.test(password)) errors.push('one number');
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) errors.push('one special character (!@#$%^&* etc.)');
    return errors;
}

// Register Lender
exports.register = async (req, res) => {
    try {
        console.log('Registration Request Body:', req.body);
        console.log('Registration Files:', req.files);
        let { name, phone, email, password, businessName, referralCode, role, nrc, companyRegistrationNumber, lenderType, planType } = req.body;

        // Default role to lender if not provided
        role = role === 'borrower' ? 'borrower' : 'lender';

        // Fallback for admin-created users without password
        if (!password) {
            password = 'LendaNet@' + Math.floor(100+Math.random()*900);
            console.log('Generating fallback password for admin user:', password);
        }

        let licenseUrl = null;
        let nrcUrl = null;
        if (req.files && req.files.length > 0) {
            const licenseFile = req.files.find(f => f.fieldname === 'license');
            if (licenseFile) {
                licenseUrl = `/uploads/${licenseFile.filename}`;
            }
            const nrcFile = req.files.find(f => f.fieldname === 'nrc_document');
            if (nrcFile) {
                nrcUrl = `/uploads/${nrcFile.filename}`;
            }
        }

        // 1. Basic Validation
        if (!name || !phone || !password || !role) {
            return res.status(400).json({ message: 'Name, Phone and Password are required' });
        }

        // 1.5 Password strength validation
        const pwErrors = validatePassword(password);
        if (pwErrors.length > 0) {
            return res.status(400).json({ message: 'Password must contain: ' + pwErrors.join(', ') });
        }

        // 2. Lender-specific Validation
        if (role === 'lender') {
            if (!nrc && !companyRegistrationNumber) {
                return res.status(400).json({ message: 'Either NRC or Company Registration Number is required' });
            }
            // Validate lender_type
            const allowedTypes = ['individual', 'micro_lender', 'cooperative'];
            if (!lenderType || !allowedTypes.includes(lenderType)) {
                return res.status(400).json({ message: 'Lender type is required. Allowed: individual, micro_lender, cooperative' });
            }
        }

        // 3. NRC Validation (if provided)
        if (nrc) {
            const nrcRegex = /^\d{6}\/\d{2}\/\d{1}$/;
            if (!nrcRegex.test(nrc)) {
                return res.status(400).json({ message: 'Invalid NRC format. Expected: XXXXXX/XX/X' });
            }
        }

        // 4. Check for existing user (Phone or Email or NRC or Company Reg)
        const [existing] = await db.execute(
            'SELECT * FROM users WHERE phone = ? OR (email IS NOT NULL AND email = ?) OR (nrc IS NOT NULL AND nrc = ?) OR (company_registration_number IS NOT NULL AND company_registration_number = ?)',
            [phone, email || '---', nrc || '---', companyRegistrationNumber || '---']
        );
        if (existing.length > 0) {
            if (existing[0].phone === phone) return res.status(400).json({ message: 'Phone number already registered' });
            if (existing[0].email === email) return res.status(400).json({ message: 'Email already registered' });
            if (existing[0].nrc === nrc)   return res.status(400).json({ message: 'NRC already registered' });
            if (existing[0].company_registration_number === companyRegistrationNumber) {
                return res.status(400).json({ message: 'Company Registration Number already registered' });
            }
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Generate a referral code for the new user
        const userReferralCode = (name.substring(0, 3).toUpperCase() + Math.floor(1000 + Math.random() * 9000)) || 'REF' + Date.now();

        const initialStatus = 'pending'; // All self-registered users (Lenders & Borrowers) start as pending

        // 5. Generate unique lender_id for lenders
        let generatedLenderId = null;
        if (role === 'lender') {
            const [lastRow] = await db.execute(
                "SELECT lender_id FROM users WHERE lender_id IS NOT NULL AND lender_id LIKE '001-3%' ORDER BY lender_id DESC LIMIT 1"
            );
            let nextNum = 3001; // Start from 001-3001
            if (lastRow.length > 0) {
                const lastSuffix = parseInt(lastRow[0].lender_id.split('-')[1]);
                nextNum = lastSuffix + 1;
            }
            generatedLenderId = '001-' + String(nextNum);
        }

        // 6. Insert user
        const finalPlanType = planType || 'free';
        const finalMembershipTier = finalPlanType !== 'free' ? 'premium' : 'free';
        const [result] = await db.execute(
            'INSERT INTO users (name, phone, email, nrc, company_registration_number, password, business_name, lender_type, lender_id, license_url, nrc_url, referral_code, role, status, membership_tier, plan_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, phone, email || null, nrc || null, companyRegistrationNumber || null, hashedPassword, businessName || null, role === 'lender' ? lenderType : null, generatedLenderId, licenseUrl || null, nrcUrl || null, userReferralCode, role, initialStatus, finalMembershipTier, finalPlanType]
        );

        const newUserId = result.insertId || null;
        // 5. If it is a borrower, we should also create a borrower profile
        if (role === 'borrower' && newUserId) {
            await db.execute(
                'INSERT INTO borrowers (name, nrc, phone) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE phone = ?',
                [name, nrc, phone, phone] 
            );
        }

        // Handle referral link if provided
        if (referralCode && newUserId) {
            const [referrer] = await db.execute('SELECT id FROM users WHERE referral_code = ?', [referralCode]);
            if (referrer && referrer.length > 0) {
                await db.execute('INSERT INTO referrals (referrer_id, referred_user_id, status) VALUES (?, ?, ?)', 
                    [referrer[0].id || null, newUserId, 'pending']);
            }
        }

        res.status(201).json({ 
            message: 'Registration successful. Please verify OTP.',
            userId: newUserId,
            lenderId: generatedLenderId
        });
    } catch (error) {
        console.error('Registration Error:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ 
                message: 'Duplicate entry detected. Phone, email, or NRC might already be in use.',
                error: error.sqlMessage 
            });
        }
        res.status(500).json({ message: 'Server error during registration', error: error.message });
    }
};

// Login
exports.login = async (req, res) => {
    try {
        const { identifier, password } = req.body; // identifier can be email or phone

        const [users] = await db.execute(
            'SELECT * FROM users WHERE email = ? OR phone = ?',
            [identifier, identifier]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        const user = users[0];

        // Check status
        if (user.status === 'pending') {
            return res.status(403).json({ message: 'Your account is pending admin approval' });
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        // Sign JWT
        const token = jwt.sign(
            { id: user.id, role: user.role, name: user.name },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );

        // Generate a referral code if missing (for legacy users or borrowers)
        if (!user.referral_code) {
            const newCode = user.name.substring(0, 3).toUpperCase() + Math.floor(1000 + Math.random() * 9000);
            await db.execute('UPDATE users SET referral_code = ? WHERE id = ?', [newCode, user.id]);
            user.referral_code = newCode;
        }

        // Dynamic Plan Label Logic
        let planLabel = 'Free Plan';
        if (user.plan_type === 'monthly') planLabel = 'Premium Plan (Monthly)';
        if (user.plan_type === 'annual') planLabel = 'Premium Plan (Annual)';

        res.json({
            token,
            user: {
                id: user.id,
                lender_id: user.lender_id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                nrc: user.nrc,
                lender_type: user.lender_type,
                business_name: user.business_name,
                referral_code: user.referral_code,
                referralCode: user.referral_code,
                role: user.role,
                status: user.status,
                verificationStatus: user.verificationStatus || 'pending',
                plan_type: user.plan_type || 'free',
                plan_label: planLabel,
                isPaid: user.plan_type !== 'free'
            }
        });
    } catch (error) {
        console.error('LOGIN ERROR:', error.message, error.code, error.stack);
        res.status(500).json({ message: 'Server error during login', error: error.message });
    }
};

// Update Profile
exports.updateProfile = async (req, res) => {
    try {
        const userId = req.user.id;
        const { name, phone, email, newPassword } = req.body;

        const updates = [];
        const params = [];

        if (name) { updates.push('name = ?'); params.push(name); }
        if (phone) { updates.push('phone = ?'); params.push(phone); }
        if (email) { updates.push('email = ?'); params.push(email); }
        
        if (newPassword) {
            const pwErrors = validatePassword(newPassword);
            if (pwErrors.length > 0) {
                return res.status(400).json({ message: 'Password must contain: ' + pwErrors.join(', ') });
            }
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            updates.push('password = ?');
            params.push(hashedPassword);
        }

        if (updates.length === 0) {
            return res.status(400).json({ message: 'No fields to update' });
        }

        params.push(userId);
        await db.execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error updating profile' });
    }
};

// Get current user profile (for refreshing user data)
exports.getMe = async (req, res) => {
    try {
        const [users] = await db.execute('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (users.length === 0) return res.status(404).json({ message: 'User not found' });

        const user = users[0];
        let planLabel = 'Free Plan';
        if (user.plan_type === 'monthly') planLabel = 'Premium Plan (Monthly)';
        if (user.plan_type === 'annual') planLabel = 'Premium Plan (Annual)';

        res.json({
            id: user.id,
            lender_id: user.lender_id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            nrc: user.nrc,
            lender_type: user.lender_type,
            business_name: user.business_name,
            referral_code: user.referral_code,
            referralCode: user.referral_code,
            role: user.role,
            status: user.status,
            verificationStatus: user.verificationStatus || 'pending',
            plan_type: user.plan_type || 'free',
            plan_label: planLabel,
            isPaid: user.plan_type !== 'free'
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Verify OTP (Mock for now)
exports.verifyOtp = async (req, res) => {
    const { userId, otp } = req.body;
    
    // In a real app, verify against stored OTP
    if (otp === '123456') {
        // Update status for demo purposes, although normally admin approves lender
        // For borrowers, this might make them active.
        return res.json({ success: true, message: 'OTP verified successfully' });
    } else {
        return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }
};
