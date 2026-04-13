const db = require('./config/db');

async function migrate() {
    try {
        console.log("Starting manual migration...");

        // 1. Add guarantor fields to loans
        try {
            await db.query("ALTER TABLE loans ADD COLUMN guarantor_name VARCHAR(255)");
            console.log("Added guarantor_name to loans");
        } catch(e) { console.log("guarantor_name might exist:", e.message); }
        
        try {
            await db.query("ALTER TABLE loans ADD COLUMN guarantor_phone VARCHAR(20)");
            console.log("Added guarantor_phone to loans");
        } catch(e) { console.log("guarantor_phone might exist:", e.message); }

        try {
            await db.query("ALTER TABLE loans ADD COLUMN guarantor_nrc VARCHAR(50)");
            console.log("Added guarantor_nrc to loans");
        } catch(e) { console.log("guarantor_nrc might exist:", e.message); }

        // 2. Add created_by/updated_by to loans
        try {
            await db.query("ALTER TABLE loans ADD COLUMN created_by INT");
            console.log("Added created_by to loans");
        } catch(e) { console.log("created_by might exist:", e.message); }

        try {
            await db.query("ALTER TABLE loans ADD COLUMN updated_by INT");
            console.log("Added updated_by to loans");
        } catch(e) { console.log("updated_by might exist:", e.message); }

        // 3. Create system_settings table
        await db.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                setting_key VARCHAR(100) PRIMARY KEY,
                setting_value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        console.log("Ensured system_settings table exists");

        // 3. Insert default settings
        await db.query(`
            INSERT IGNORE INTO system_settings (setting_key, setting_value) 
            VALUES ('borrower_self_registration', 'true')
        `);
        console.log("Inserted default settings");

        // 4. Add verificationStatus to borrowers
        try {
            await db.query("ALTER TABLE borrowers ADD COLUMN verificationStatus ENUM('pending', 'verified', 'rejected') DEFAULT 'pending'");
            console.log("Added verificationStatus to borrowers");
        } catch(e) { console.log("verificationStatus might exist:", e.message); }

        // 5. Create upgrade_requests table
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS upgrade_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    plan_id INT NOT NULL,
                    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE CASCADE
                )
            `);
            console.log("Ensured upgrade_requests table exists");
        } catch(e) { console.log("upgrade_requests table error:", e.message); }

        // 6. Seed Membership Plans (Free, Monthly, Annual)
        try {
            // Update existing Premium plan to Monthly
            await db.query(`UPDATE membership_plans SET name = 'Monthly' WHERE id = 2 AND name = 'Premium'`);
            console.log("Renamed Premium to Monthly");

            // Insert Annual plan if not exists
            await db.query(`
                INSERT IGNORE INTO membership_plans (id, name, price, duration_days, features_json, status) VALUES
                (3, 'Annual', 100.00, 365, '{"search": true, "risk": true, "history": true}', 'active')
            `);
            console.log("Seeded membership plans (Free, Monthly, Annual)");
        } catch(e) { console.log("membership_plans seed error:", e.message); }

        // 7. Add missing columns to users table
        const userColumns = [
            { col: 'company_registration_number', sql: "ALTER TABLE users ADD COLUMN company_registration_number VARCHAR(100)" },
            { col: 'lender_type', sql: "ALTER TABLE users ADD COLUMN lender_type ENUM('individual', 'micro_lender', 'cooperative') DEFAULT NULL" },
            { col: 'lender_id', sql: "ALTER TABLE users ADD COLUMN lender_id VARCHAR(20) UNIQUE" },
            { col: 'plan_type', sql: "ALTER TABLE users ADD COLUMN plan_type VARCHAR(20) DEFAULT 'free'" },
        ];
        for (const { col, sql } of userColumns) {
            try {
                await db.query(sql);
                console.log(`Added ${col} to users`);
            } catch(e) { console.log(`${col} might exist:`, e.message); }
        }

        // 8. Add nrc_url column to users and borrowers tables
        try {
            await db.query("ALTER TABLE users ADD COLUMN nrc_url TEXT");
            console.log("Added nrc_url to users");
        } catch(e) { console.log("nrc_url might exist in users:", e.message); }

        try {
            await db.query("ALTER TABLE borrowers ADD COLUMN nrc_url TEXT");
            console.log("Added nrc_url to borrowers");
        } catch(e) { console.log("nrc_url might exist in borrowers:", e.message); }

        // 9. Add requested_plan column to upgrade_requests table
        try {
            await db.query("ALTER TABLE upgrade_requests ADD COLUMN requested_plan VARCHAR(20) DEFAULT NULL AFTER user_id");
            console.log("Added requested_plan to upgrade_requests");
        } catch(e) { console.log("requested_plan might exist:", e.message); }

        // 10. Add collateral_upload_enabled setting
        await db.query(`
            INSERT IGNORE INTO system_settings (setting_key, setting_value)
            VALUES ('collateral_upload_enabled', 'true')
        `);
        console.log("Added collateral_upload_enabled setting");

        console.log("Migration complete!");
        process.exit(0);
    } catch (err) {
        console.error("Migration failed:", err);
        process.exit(1);
    }
}

migrate();
