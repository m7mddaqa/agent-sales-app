// Action history & undo.
// Every catalog-mutating action stores a full snapshot of products + categories,
// so any action can be undone by restoring the catalog to the state before it.
const zlib = require('zlib');
const db = require('../db');

// snapshots are deflate-compressed: with a full catalog the raw JSON runs to
// megabytes per action, and up to 100 actions are retained
function snapshotCatalog() {
  return zlib.deflateSync(JSON.stringify({
    products: db.prepare('SELECT * FROM products').all(),
    categories: db.prepare('SELECT * FROM categories').all()
  }));
}

function logAction(user, type, description, snapshot) {
  db.prepare(`INSERT INTO actions (user_id, user_name, type, description, snapshot) VALUES (?, ?, ?, ?, ?)`)
    .run(user.id, user.name, type, description, snapshot);
  db.prepare(`DELETE FROM actions WHERE id NOT IN (SELECT id FROM actions ORDER BY id DESC LIMIT 100)`).run();
  // snapshots are ~1.4 MB each with a full catalog — keep undo data only for recent actions
  db.prepare(`UPDATE actions SET snapshot = '' WHERE snapshot != ''
    AND id NOT IN (SELECT id FROM actions ORDER BY id DESC LIMIT 20)`).run();
}

const restoreCatalogTx = db.transaction((snap) => {
  db.prepare('DELETE FROM products').run();
  db.prepare('DELETE FROM categories').run();
  const insCat = db.prepare('INSERT INTO categories (id, name, parent_id) VALUES (@id, @name, @parent_id)');
  for (const c of snap.categories) insCat.run(c);
  const prodCols = Object.keys(snap.products[0] || {});
  if (snap.products.length) {
    const insProd = db.prepare(`INSERT INTO products (${prodCols.join(',')}) VALUES (${prodCols.map(c => '@' + c).join(',')})`);
    for (const p of snap.products) insProd.run(p);
  }
  // re-link any order lines whose product no longer exists in the restored catalog
  db.prepare(`UPDATE order_items SET product_id = NULL WHERE product_id IS NOT NULL
    AND product_id NOT IN (SELECT id FROM products)`).run();
});

function restoreCatalog(snapshot) {
  // Buffer = compressed (current format); string = legacy uncompressed JSON
  const json = Buffer.isBuffer(snapshot) ? zlib.inflateSync(snapshot).toString('utf8') : snapshot;
  const snap = JSON.parse(json);
  // FKs off so deleting products doesn't null out order_items (rows are reinserted with the same ids)
  db.pragma('foreign_keys = OFF');
  try {
    restoreCatalogTx(snap);
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

module.exports = { snapshotCatalog, logAction, restoreCatalog };
