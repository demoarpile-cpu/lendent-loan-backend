const mysql = require('mysql2/promise');
require('dotenv').config();

// Support both custom DB_* vars and Railway's auto-injected MYSQL* vars
const dbConfig = {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: process.env.DB_PORT || process.env.MYSQLPORT || 3306,
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASS || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'lendanet_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    // ✅ Fix: Keep connections alive to prevent ECONNRESET from Railway idle timeout
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000, // 10 seconds
    connectTimeout: 30000,        // 30 second timeout for new connections
};

// Enable SSL only for non-local connections
if (dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
    dbConfig.ssl = { rejectUnauthorized: false };
}

console.log(`[DB] Connecting to ${dbConfig.host}:${dbConfig.port} database: ${dbConfig.database}`);

const pool = mysql.createPool(dbConfig);

// ✅ Fix: Auto-retry wrapper to handle Railway connection drops gracefully
const originalExecute = pool.execute.bind(pool);
const originalQuery = pool.query.bind(pool);

async function withRetry(operation, ...args) {
    let retries = 3;
    while (retries > 0) {
        try {
            return await operation(...args);
        } catch (error) {
            if (['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'EPIPE'].includes(error.code)) {
                console.warn(`[DB] Connection error (${error.code}). Retrying... (${3 - retries + 1}/3)`);
                retries--;
                if (retries === 0) throw error;
                // Wait briefly before retrying
                await new Promise(res => setTimeout(res, 500));
            } else {
                throw error;
            }
        }
    }
}

pool.execute = (...args) => withRetry(originalExecute, ...args);
pool.query = (...args) => withRetry(originalQuery, ...args);

// ✅ Fix: Ping pool every 1 minute to keep connections alive (prevents Railway idle timeout)
setInterval(async () => {
    try {
        await pool.execute('SELECT 1');
    } catch (err) {
        console.warn('[DB] KeepAlive ping failed:', err.message);
    }
}, 1 * 60 * 1000); // Every 1 minute instead of 5

module.exports = pool;
