-- LendaNet Database Schema

CREATE DATABASE IF NOT EXISTS lendanet_db;
USE lendanet_db;

-- 1. Users Table (Admins, Lenders, Borrowers)
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    nrc VARCHAR(50) UNIQUE, -- Format: XXXXXX/XX/X (e.g. 123456/78/1)
    dob DATE,
    password VARCHAR(255) NOT NULL,
    company_registration_number VARCHAR(100),
    business_name VARCHAR(255),
    lender_type ENUM('individual', 'micro_lender', 'cooperative') DEFAULT NULL,
    lender_id VARCHAR(20) UNIQUE,
    license_url TEXT,
    nrc_url TEXT,
    plan_type VARCHAR(20) DEFAULT 'free',
    role ENUM('admin', 'lender', 'borrower') NOT NULL DEFAULT 'lender',
    referral_code VARCHAR(50) UNIQUE,
    isPaid BOOLEAN DEFAULT FALSE,
    verificationStatus ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
    membership_tier VARCHAR(20) DEFAULT 'free',
    status ENUM('pending', 'active', 'disabled') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 2. Borrowers Table (Profile Data)
CREATE TABLE IF NOT EXISTS borrowers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    nrc VARCHAR(50) UNIQUE NOT NULL, -- Format: XXXXXX/XX/X (e.g. 123456/78/1)
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) NOT NULL,
    dob DATE,
    photo_url TEXT,
    nrc_url TEXT,
    verificationStatus ENUM('pending', 'verified', 'rejected') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 3. Lender-Borrower Junction (To track which lender added which borrower)
CREATE TABLE IF NOT EXISTS lender_borrowers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lender_id INT NOT NULL,
    borrower_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE,
    UNIQUE KEY (lender_id, borrower_id)
);

-- 4. Loans Table
CREATE TABLE IF NOT EXISTS loans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    lender_id INT NOT NULL,
    borrower_id INT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    interest_rate DECIMAL(5, 2) NOT NULL,
    issue_date DATE NOT NULL,
    due_date DATE NOT NULL,
    type ENUM('Collateral', 'Non', 'Guarantor') NOT NULL DEFAULT 'Non',
    guarantor_name VARCHAR(255),
    guarantor_phone VARCHAR(20),
    guarantor_nrc VARCHAR(50),
    status ENUM('active', 'paid', 'default', 'locked') NOT NULL DEFAULT 'active',
    created_by INT,
    updated_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (lender_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (borrower_id) REFERENCES borrowers(id) ON DELETE CASCADE
);

-- 5. Loan Installments Table
CREATE TABLE IF NOT EXISTS loan_installments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    loan_id INT NOT NULL,
    due_date DATE NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    status ENUM('pending', 'paid') NOT NULL DEFAULT 'pending',
    paid_amount DECIMAL(15, 2) DEFAULT 0,
    paid_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
);

-- 6. Payments Table
CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    loan_id INT NOT NULL,
    installment_id INT,
    amount DECIMAL(15, 2) NOT NULL,
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    method VARCHAR(50),
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
    FOREIGN KEY (installment_id) REFERENCES loan_installments(id) ON DELETE SET NULL
);

-- 7. Shared Default Ledger
CREATE TABLE IF NOT EXISTS default_ledger (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nrc VARCHAR(50) NOT NULL,
    loan_id INT NOT NULL,
    lender_id INT NOT NULL,
    default_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    amount DECIMAL(15, 2) NOT NULL,
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE,
    FOREIGN KEY (lender_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 8. Referrals Table
CREATE TABLE IF NOT EXISTS referrals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    referrer_id INT NOT NULL,
    referred_user_id INT NOT NULL,
    status ENUM('pending', 'qualified') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 9. Referral Rewards
CREATE TABLE IF NOT EXISTS referral_rewards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    referrer_id INT NOT NULL,
    referral_id INT NOT NULL,
    amount DECIMAL(15, 2) NOT NULL,
    status ENUM('pending', 'redeemed') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (referrer_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (referral_id) REFERENCES referrals(id) ON DELETE CASCADE
);

-- 10. Membership Plans
CREATE TABLE IF NOT EXISTS membership_plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    duration_days INT NOT NULL,
    features_json JSON,
    status ENUM('active', 'inactive') DEFAULT 'active'
);

-- 12. Upgrade Requests (Manual Flow)
CREATE TABLE IF NOT EXISTS upgrade_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    requested_plan VARCHAR(20) DEFAULT NULL,
    plan_id INT NOT NULL,
    status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (plan_id) REFERENCES membership_plans(id) ON DELETE CASCADE
);

-- 13. Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT,
    action VARCHAR(255) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INT,
    details TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 13. Collaterals
CREATE TABLE IF NOT EXISTS collaterals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    loan_id INT NOT NULL,
    file_url TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (loan_id) REFERENCES loans(id) ON DELETE CASCADE
);

-- 14. Default Admin User (Password: admin123)
INSERT IGNORE INTO users (name, phone, email, password, role, status, verificationStatus) 
VALUES ('Super Admin', '0999999999', 'admin@lendanet.com', '$2b$10$BHJKjkE2AUZzvHbmXlIbSOlOZupGimzqmLZHfVDK1eY8wC.re6rtm', 'admin', 'active', 'verified');

-- 15. System Settings
CREATE TABLE IF NOT EXISTS system_settings (
    setting_key VARCHAR(100) PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('borrower_self_registration', 'true');
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('default_threshold', '3');
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('default_period_days', '30');
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('collateral_upload_enabled', 'true');
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('free_trial_enabled', 'false');
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('free_trial_days', '365');
INSERT IGNORE INTO system_settings (setting_key, setting_value) VALUES ('free_access_enabled', 'true');

-- 16. Seed Membership Plans
INSERT IGNORE INTO membership_plans (id, name, price, duration_days, features_json, status) VALUES
(1, 'Free', 0.00, 0, '{"search": false, "risk": false, "history": false}', 'active'),
(2, 'Monthly', 10.00, 30, '{"search": true, "risk": true, "history": true}', 'active'),
(3, 'Annual', 100.00, 365, '{"search": true, "risk": true, "history": true}', 'active');
