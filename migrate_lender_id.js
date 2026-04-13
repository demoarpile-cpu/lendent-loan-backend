const db = require('./config/db');

async function migrate() {
    try {
        console.log('Starting migration...');

        // 1. Add lender_type column if it doesn't exist
        const [col1] = await db.execute('SHOW COLUMNS FROM users LIKE "lender_type"');
        if (col1.length === 0) {
            console.log('Adding lender_type column...');
            await db.execute("ALTER TABLE users ADD COLUMN lender_type ENUM('individual','micro_lender','cooperative') DEFAULT 'individual' AFTER business_name");
        } else {
            console.log('lender_type column already exists.');
        }

        // 2. Add lender_id column if it doesn't exist
        const [col2] = await db.execute('SHOW COLUMNS FROM users LIKE "lender_id"');
        if (col2.length === 0) {
            console.log('Adding lender_id column...');
            await db.execute('ALTER TABLE users ADD COLUMN lender_id VARCHAR(20) UNIQUE AFTER id');
        } else {
            console.log('lender_id column already exists.');
        }

        // 3. Backfill lender_id for existing lenders who don't have one
        const [existingLenders] = await db.execute('SELECT id FROM users WHERE role = "lender" AND (lender_id IS NULL OR lender_id = "") ORDER BY id ASC');
        if (existingLenders.length > 0) {
            console.log(`Backfilling lender_id for ${existingLenders.length} existing lenders...`);
            const [lastRow] = await db.execute('SELECT lender_id FROM users WHERE lender_id IS NOT NULL AND lender_id LIKE "001-3%" ORDER BY lender_id DESC LIMIT 1');
            let nextNum = 1;
            if (lastRow.length > 0) {
                const lastDigits = parseInt(lastRow[0].lender_id.replace('001-3', ''));
                nextNum = lastDigits + 1;
            }
            for (const lender of existingLenders) {
                const newId = '001-3' + String(nextNum).padStart(4, '0');
                await db.execute('UPDATE users SET lender_id = ? WHERE id = ?', [newId, lender.id]);
                console.log(`  Assigned ${newId} to user #${lender.id}`);
                nextNum++;
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
