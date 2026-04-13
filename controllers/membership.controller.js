const db = require('../config/db');

// Request Membership Upgrade
exports.requestUpgrade = async (req, res) => {
    try {
        const { selected_plan, notes } = req.body;
        const userId = req.user.id;

        if (!selected_plan || !['monthly', 'annual'].includes(selected_plan)) {
            return res.status(400).json({ message: 'Please select a valid plan (monthly or annual)' });
        }

        // Check current plan
        const [user] = await db.execute('SELECT plan_type FROM users WHERE id = ?', [userId]);
        if (user[0].plan_type === selected_plan) {
            return res.status(400).json({ message: `You are already on the ${selected_plan} plan` });
        }

        // Check if a pending request already exists
        const [existing] = await db.execute(
            'SELECT id FROM upgrade_requests WHERE user_id = ? AND status = "pending"',
            [userId]
        );

        if (existing.length > 0) {
            return res.status(400).json({ message: 'You already have a pending upgrade request' });
        }

        // Get plan ID for legacy support if needed, but we'll use requested_plan
        const [plan] = await db.execute('SELECT id FROM membership_plans WHERE name = ?', [selected_plan]);
        const planId = plan.length > 0 ? plan[0].id : 2; // Default to monthly if not found

        await db.execute(
            'INSERT INTO upgrade_requests (user_id, requested_plan, plan_id, notes) VALUES (?, ?, ?, ?)',
            [userId, selected_plan, planId, notes || null]
        );

        // Add Audit Log
        await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
            ['UPGRADE_REQUEST', userId, `Requested upgrade to: ${selected_plan}`]);

        res.status(201).json({ message: 'Upgrade request sent to admin for approval' });
    } catch (error) {
        console.error('Request Upgrade Error:', error);
        res.status(500).json({ message: 'Server error sending upgrade request' });
    }
};

// Get All Upgrade Requests (Admin)
exports.getUpgradeRequests = async (req, res) => {
    try {
        const [requests] = await db.execute(`
            SELECT ur.*, u.name as userName, u.phone, u.email, 
                   COALESCE(ur.requested_plan, mp.name) as planName 
            FROM upgrade_requests ur
            JOIN users u ON ur.user_id = u.id
            LEFT JOIN membership_plans mp ON ur.plan_id = mp.id
            ORDER BY ur.created_at DESC
        `);
        res.json(requests);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching requests' });
    }
};

// Handle Upgrade Request (Approve/Reject)
exports.handleUpgradeRequest = async (req, res) => {
    try {
        const { requestId, status } = req.body; // status: 'approved' or 'rejected'
        
        const [request] = await db.execute('SELECT * FROM upgrade_requests WHERE id = ?', [requestId]);
        if (request.length === 0) return res.status(404).json({ message: 'Request not found' });

        await db.execute('UPDATE upgrade_requests SET status = ? WHERE id = ?', [status, requestId]);

        if (status === 'approved') {
            const planType = request[0].requested_plan || 'monthly';
            
            await db.execute('UPDATE users SET plan_type = ?, membership_tier = ?, isPaid = ? WHERE id = ?', 
                [planType, planType, true, request[0].user_id]);
            
            await db.execute('INSERT INTO audit_logs (action, user_id, details) VALUES (?, ?, ?)', 
                ['UPGRADE_APPROVED', req.user.id, `Approved ${planType} upgrade for user ID: ${request[0].user_id}`]);
        }

        res.json({ message: `Upgrade request ${status}` });
    } catch (error) {
        console.error('Handle Request Error:', error);
        res.status(500).json({ message: 'Server error handling request' });
    }
};

// Get Membership Plans
exports.getPlans = async (req, res) => {
    try {
        const [plans] = await db.execute('SELECT * FROM membership_plans WHERE status = "active"');
        res.json(plans);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server error fetching plans' });
    }
};
