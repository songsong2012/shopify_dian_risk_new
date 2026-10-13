const fs = require('fs');
try {
  const db = require('better-sqlite3')(':memory:');
  db.exec('CREATE TABLE t(a TEXT)');
  db.prepare('INSERT INTO t VALUES(?)').run('ok');
  const val = db.prepare('SELECT a FROM t').get().a;
  fs.writeFileSync('/opt/shopify-risk-app/sqlite-status.txt', 'SQLITE_OK: ' + val);
  console.log('SQLITE_OK: ' + val);
} catch (e) {
  fs.writeFileSync('/opt/shopify-risk-app/sqlite-status.txt', 'SQLITE_FAIL: ' + e.message);
  console.log('SQLITE_FAIL: ' + e.message);
}
