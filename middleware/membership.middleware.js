const db = require('../config/db');

module.exports = async (req, res, next) => {
    try {
        const userId = req.user.id;

        // Admin always has access
        if (req.user.role === 'admin') return next();

        // Check membership from users table
        const [users] = await db.execute(
            'SELECT plan_type, membership_tier, isPaid FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(401).json({ message: 'User not found' });
        }

        req.isPaid = users[0].plan_type !== 'free' || users[0].isPaid === 1;
        next();
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error checking membership' });
    }
};
