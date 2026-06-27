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
        try {
            await db.execute('ALTER TABLE users ADD COLUMN otp_code VARCHAR(10) NULL AFTER password');
            console.log('[DB-SYNC] Added "otp_code" column to "users" table.');
        } catch (error) {
            if (!(error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column'))) {
                throw error;
            }
        }

        try {
            await db.execute('ALTER TABLE users ADD COLUMN otp_expires_at DATETIME NULL AFTER otp_code');
            console.log('[DB-SYNC] Added "otp_expires_at" column to "users" table.');
        } catch (error) {
            if (!(error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column'))) {
                throw error;
            }
        }

        try {
            await db.execute('ALTER TABLE users ADD COLUMN one_signal_player_id VARCHAR(255) NULL AFTER profile_image_url');
            console.log('[DB-SYNC] Added "one_signal_player_id" column to "users" table.');
        } catch (error) {
            if (!(error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column'))) {
                throw error;
            }
        }

        // Security: Add otp_failed_attempts column for OTP brute-force protection
        try {
            await db.execute('ALTER TABLE users ADD COLUMN otp_failed_attempts TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER otp_expires_at');
            console.log('[DB-SYNC] Added "otp_failed_attempts" column to "users" table.');
        } catch (error) {
            if (!(error.code === 'ER_DUP_FIELDNAME' || error.message.includes('Duplicate column'))) {
                throw error;
            }
        }

        try {
            await db.execute('ALTER TABLE users MODIFY phone VARCHAR(255), MODIFY nrc VARCHAR(255), MODIFY email VARCHAR(255)');
            console.log('[DB-SYNC] Altered phone, nrc, email to VARCHAR(255) in users table.');
        } catch (error) {
            console.error('[DB-SYNC] Error modifying users columns:', error.message);
        }

        try {
            await db.execute('ALTER TABLE borrowers MODIFY phone VARCHAR(255), MODIFY nrc VARCHAR(255), MODIFY email VARCHAR(255)');
            console.log('[DB-SYNC] Altered phone, nrc, email to VARCHAR(255) in borrowers table.');
        } catch (error) {
            console.error('[DB-SYNC] Error modifying borrowers columns:', error.message);
        }

        try {
            await db.execute("ALTER TABLE users MODIFY COLUMN status ENUM('pending','active','disabled','deactivated') DEFAULT 'pending'");
            console.log('[DB-SYNC] Updated status ENUM to include deactivated in users table.');
        } catch (error) {
            console.error('[DB-SYNC] Error modifying status ENUM:', error.message);
        }

        try {
            await db.execute("ALTER TABLE loan_installments MODIFY COLUMN status ENUM('pending','paid','missed','awaiting_confirmation') DEFAULT 'pending'");
            console.log('[DB-SYNC] Updated status ENUM to include awaiting_confirmation in loan_installments table.');
        } catch (error) {
            console.error('[DB-SYNC] Error modifying loan_installments status ENUM:', error.message);
        }

        console.log('[DB-SYNC] Database schema is up to date.');
    } catch (error) {
        console.error('[DB-SYNC] Failed to sync database schema:', error.message);
    }
}

module.exports = { syncSchema };
