const db = require('./config/db');
async function test() {
    try {
        const [users] = await db.execute('SELECT name, nrc, phone FROM borrowers LIMIT 10');
        console.log('BORROWERS:', JSON.stringify(users, null, 2));
        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
test();
