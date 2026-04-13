const mysql = require('mysql2/promise');
require('dotenv').config();

// Support both custom DB_* vars and Railway's auto-injected MYSQL* vars
const dbConfig = {
    host:     process.env.DB_HOST     || process.env.MYSQLHOST     || 'localhost',
    port:     process.env.DB_PORT     || process.env.MYSQLPORT     || 3306,
    user:     process.env.DB_USER     || process.env.MYSQLUSER     || 'root',
    password: process.env.DB_PASS     || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME     || process.env.MYSQLDATABASE || 'lendanet_db',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
};

// Enable SSL only for non-local connections
if (dbConfig.host !== 'localhost' && dbConfig.host !== '127.0.0.1') {
    dbConfig.ssl = { rejectUnauthorized: false };
}

console.log(`[DB] Connecting to ${dbConfig.host}:${dbConfig.port} database: ${dbConfig.database}`);

const pool = mysql.createPool(dbConfig);

module.exports = pool;
