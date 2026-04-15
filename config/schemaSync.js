const db = require('./db');

/**
 * Automatically syncs the database schema on server startup.
 * Ensures that all necessary columns exist in the tables.
 */
async function syncSchema() {
    try {
        console.log('[DB-SYNC] Checking database schema for missing columns...');

        // 1. Check/Add 'dob' column in 'users' table
        try {
            await db.execute('ALTER TABLE users ADD COLUMN dob DATE AFTER nrc');
            console.log('[DB-SYNC] Added "dob" column to "users" table.');
        } catch (error) {
            if (error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column')) {
                // Ignore if it already exists
            } else {
                throw error;
            }
        }

        // 2. Check/Add 'dob' column in 'borrowers' table (if not already there)
        try {
            await db.execute('ALTER TABLE borrowers ADD COLUMN dob DATE AFTER phone');
            console.log('[DB-SYNC] Added "dob" column to "borrowers" table.');
        } catch (error) {
            if (error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column')) {
                // Ignore if it already exists
            } else {
                throw error;
            }
        }

        // Add more schema migrations here in the future...

        console.log('[DB-SYNC] Database schema is up to date.');
    } catch (error) {
        console.error('[DB-SYNC] Failed to sync database schema:', error.message);
    }
}

module.exports = { syncSchema };
