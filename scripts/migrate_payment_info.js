const db = require('../config/db');

async function migrate() {
    try {
        console.log('Starting payment columns migration...');
        
        const columnsToAdd = [
            { name: 'airtel_money_number', type: 'VARCHAR(20) DEFAULT NULL' },
            { name: 'mtn_money_number', type: 'VARCHAR(20) DEFAULT NULL' },
            { name: 'zamtel_money_number', type: 'VARCHAR(20) DEFAULT NULL' },
            { name: 'bank_name', type: 'VARCHAR(255) DEFAULT NULL' },
            { name: 'bank_account_number', type: 'VARCHAR(50) DEFAULT NULL' },
            { name: 'bank_account_name', type: 'VARCHAR(255) DEFAULT NULL' }
        ];

        for (const col of columnsToAdd) {
            const [existing] = await db.execute(`
                SELECT COLUMN_NAME 
                FROM INFORMATION_SCHEMA.COLUMNS 
                WHERE TABLE_NAME = 'users' 
                AND COLUMN_NAME = ?
                AND TABLE_SCHEMA = DATABASE()
            `, [col.name]);

            if (existing.length === 0) {
                console.log(`Adding column: ${col.name}`);
                await db.execute(`ALTER TABLE users ADD COLUMN ${col.name} ${col.type}`);
            } else {
                console.log(`Column ${col.name} already exists.`);
            }
        }

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrate();
