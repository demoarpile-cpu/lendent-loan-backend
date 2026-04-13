const db = require('./config/db');
(async () => {
    try {
        await db.execute("UPDATE users SET lender_id = '001-3001' WHERE lender_id = '001-30001'");
        await db.execute("UPDATE users SET lender_id = '001-3002' WHERE lender_id = '001-30002'");
        await db.execute("UPDATE users SET lender_id = '001-3003' WHERE lender_id = '001-30003'");
        console.log('Fixed IDs successfully');
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
