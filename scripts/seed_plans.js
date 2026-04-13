const db = require('../config/db');

async function seed() {
    try {
        console.log('Seeding membership plans...');
        
        const plans = [
            { name: 'Monthly Basic', price: 299, duration: 30 },
            { name: 'Monthly Premium', price: 799, duration: 30 },
            { name: 'Annual Pro', price: 6999, duration: 365 }
        ];

        for (const plan of plans) {
            await db.execute(
                'INSERT IGNORE INTO membership_plans (name, price, duration_days, status) VALUES (?, ?, ?, "active")',
                [plan.name, plan.price, plan.duration]
            );
        }

        console.log('Seeding successful! 🚀');
        process.exit(0);
    } catch (error) {
        console.error('Seeding failed:', error);
        process.exit(1);
    }
}

seed();
