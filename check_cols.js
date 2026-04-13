const db = require('./config/db');

async function checkCols() {
    try {
        const [rows] = await db.execute("SHOW COLUMNS FROM users");
        console.log(rows);
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
checkCols();
