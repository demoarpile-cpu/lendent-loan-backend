const db = require('../config/db');

async function syncPlans() {
    try {
        console.log('🔄 Syncing membership plans...');
        
        // Plans as requested: Free, Monthly, Annual
        const expectedPlans = [
            { id: 1, name: 'Free', price: 0.00, duration: 0 },
            { id: 2, name: 'Monthly', price: 200.00, duration: 30 },
            { id: 3, name: 'Annual', price: 1000.00, duration: 365 }
        ];

        for (const plan of expectedPlans) {
            // Check if plan exists by ID or Name
            const [rows] = await db.execute('SELECT id FROM membership_plans WHERE id = ?', [plan.id]);
            
            if (rows.length > 0) {
                console.log(`Updating plan: ${plan.name}`);
                await db.execute(
                    'UPDATE membership_plans SET name = ?, price = ?, duration_days = ?, status = "active" WHERE id = ?',
                    [plan.name, plan.price, plan.duration, plan.id]
                );
            } else {
                console.log(`Inserting plan: ${plan.name}`);
                await db.execute(
                    'INSERT INTO membership_plans (id, name, price, duration_days, status) VALUES (?, ?, ?, ?, "active")',
                    [plan.id, plan.name, plan.price, plan.duration]
                );
            }
        }

        console.log('✅ Membership plans synced successfully!');
        process.exit(0);
    } catch (error) {
        console.error('❌ Sync failed:', error);
        process.exit(1);
    }
}

syncPlans();
