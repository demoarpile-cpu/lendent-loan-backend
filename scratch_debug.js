const db = require('./config/db');

(async () => {
    try {
        const [u] = await db.query("SELECT id, name, email, nrc, role FROM users WHERE name LIKE '%riya%'");
        console.log('USERS:', u);

        const [b] = await db.query("SELECT id, name, email, nrc FROM borrowers WHERE name LIKE '%riya%'");
        console.log('BORROWERS:', b);

        const [l] = await db.query("SELECT * FROM loans WHERE borrower_id IN (SELECT id FROM borrowers WHERE name LIKE '%riya%')");
        console.log('LOANS:', l);

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
})();
