const mysql = require('mysql2/promise');

const db = mysql.createPool({
  host: 'shuttle.proxy.rlwy.net',
  port: 29055,
  user: 'root',
  password: 'uOMcPQdYXlUppwDcdlEmDqTSrOwOUMmq',
  database: 'railway',
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const [rows] = await db.execute(`
    SELECT
      b.id,
      (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id) as totalLoans,
      (SELECT COUNT(*) FROM loans WHERE borrower_id = b.id AND status = 'default') as defaultCount,
      (SELECT COUNT(*) FROM loan_installments li JOIN loans l ON li.loan_id = l.id WHERE l.borrower_id = b.id AND li.status = 'pending' AND li.due_date < CURRENT_DATE) as missedCount
    FROM borrowers b WHERE b.id = 2
  `);
  console.log('\n=== Borrower ID=2 risk breakdown ===');
  console.table(rows);
  const b = rows[0];
  let risk = 'GREEN';
  if (b.defaultCount > 0 || b.missedCount > 0) risk = 'RED';
  else if (b.totalLoans > 3) risk = 'AMBER';
  console.log('Computed risk:', risk);
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
