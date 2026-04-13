const db = require('../config/db');

// Get Referral Stats
exports.getStats = async (req, res) => {
    try {
        const userId = req.user.id;
        const [referrals] = await db.execute(
            `SELECT r.*, u.name as referredName, u.role as referredRole 
             FROM referrals r 
             JOIN users u ON r.referred_user_id = u.id 
             WHERE r.referrer_id = ?`,
            [userId]
        );
        const [rewards] = await db.execute(
            'SELECT SUM(amount) as totalEarned FROM referral_rewards WHERE referrer_id = ?',
            [userId]
        );
        res.json({ 
            referrals, 
            totalEarned: rewards[0].totalEarned || 0,
            referralCount: referrals.length
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};

// Check and Trigger Rewards (Logic: Referred lender added >= 10 borrowers)
exports.checkQualification = async (req, res) => {
    try {
        const { referralId } = req.body;
        
        // 1. Get referral info
        const [referral] = await db.execute('SELECT * FROM referrals WHERE id = ?', [referralId]);
        if (referral.length === 0) return res.status(404).json({ message: 'Referral not found' });
        if (referral[0].status === 'qualified') return res.json({ message: 'Already qualified' });

        // 2. Count borrowers added by referred user
        const [count] = await db.execute(
            'SELECT COUNT(*) as borrowerCount FROM lender_borrowers WHERE lender_id = ?',
            [referral[0].referred_user_id]
        );

        if (count[0].borrowerCount >= 10) {
            // 1. Get referrer role
            const [referrer] = await db.execute('SELECT role FROM users WHERE id = ?', [referral[0].referrer_id]);
            const role = referrer[0].role;

            // 2. Fetch reward amount from settings
            const settingKey = role === 'lender' ? 'lender_referral_reward' : 'borrower_referral_reward';
            const [settings] = await db.execute('SELECT setting_value FROM settings WHERE setting_key = ?', [settingKey]);
            const rewardAmount = parseFloat(settings[0]?.setting_value || (role === 'lender' ? '500' : '50'));

            // 3. Qualify and Reward
            await db.execute('UPDATE referrals SET status = "qualified" WHERE id = ?', [referralId]);
            await db.execute('INSERT INTO referral_rewards (referrer_id, referral_id, amount, status) VALUES (?, ?, ?, ?)',
                [referral[0].referrer_id, referralId, rewardAmount, 'pending']);
            
            return res.json({ message: `Referral qualified! K${rewardAmount} reward added.` });
        }

        res.json({ message: `Progress: ${count[0].borrowerCount}/10 borrowers added.` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error' });
    }
};
