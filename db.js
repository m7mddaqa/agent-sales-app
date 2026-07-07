const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const db = new Database(path.join(__dirname, 'data', 'app.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'agent' CHECK (role IN ('admin','agent')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  price REAL NOT NULL DEFAULT 0,
  cost REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  discount_pct REAL NOT NULL DEFAULT 0,
  image TEXT DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  agent_id INTEGER NOT NULL REFERENCES users(id),
  customer_name TEXT DEFAULT '',
  customer_phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','delivered','cancelled')),
  notes TEXT DEFAULT '',
  total REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  sku TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  discount_pct REAL NOT NULL DEFAULT 0,
  line_total REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  user_name TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  snapshot TEXT NOT NULL DEFAULT '',
  undone INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(agent_id);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
`);

// Migration: VAT + image source columns
const prodCols = db.prepare(`PRAGMA table_info(products)`).all().map(c => c.name);
if (!prodCols.includes('vat')) {
  db.exec(`ALTER TABLE products ADD COLUMN vat INTEGER NOT NULL DEFAULT 1`);
}
if (!prodCols.includes('image_source')) {
  db.exec(`ALTER TABLE products ADD COLUMN image_source TEXT DEFAULT ''`);
}
if (!prodCols.includes('barcode')) {
  db.exec(`ALTER TABLE products ADD COLUMN barcode TEXT DEFAULT ''`);
}
const orderCols0 = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
if (!orderCols0.includes('subtotal')) {
  db.exec(`ALTER TABLE orders ADD COLUMN subtotal REAL NOT NULL DEFAULT 0`);
  db.exec(`ALTER TABLE orders ADD COLUMN vat_amount REAL NOT NULL DEFAULT 0`);
  // orders placed before VAT support: treat the stored total as the subtotal
  db.exec(`UPDATE orders SET subtotal = total WHERE subtotal = 0`);
}
const itemCols = db.prepare(`PRAGMA table_info(order_items)`).all().map(c => c.name);
if (!itemCols.includes('vat_rate')) {
  db.exec(`ALTER TABLE order_items ADD COLUMN vat_rate REAL NOT NULL DEFAULT 0`);
}

// Seed default settings
if (!db.prepare(`SELECT value FROM settings WHERE key = 'vat_rate'`).get()) {
  db.prepare(`INSERT INTO settings (key, value) VALUES ('vat_rate', '18')`).run();
}

// Migration: link orders to customers
const orderCols = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
if (!orderCols.includes('customer_id')) {
  db.exec(`ALTER TABLE orders ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL`);
}

// Backfill customers from order snapshots taken before the customers table existed
const orphanCustomers = db.prepare(`SELECT DISTINCT customer_name, customer_phone FROM orders
  WHERE customer_id IS NULL AND TRIM(customer_name) != ''`).all();
for (const o of orphanCustomers) {
  const existing = db.prepare(`SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND phone = ?`)
    .get(o.customer_name, o.customer_phone);
  const custId = existing
    ? existing.id
    : db.prepare(`INSERT INTO customers (name, phone) VALUES (?, ?)`).run(o.customer_name, o.customer_phone).lastInsertRowid;
  db.prepare(`UPDATE orders SET customer_id = ? WHERE customer_name = ? AND customer_phone = ? AND customer_id IS NULL`)
    .run(custId, o.customer_name, o.customer_phone);
}

// Migration: renumber legacy random order numbers to sequential starting at 1000
const legacyOrders = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE order_no NOT GLOB '[0-9]*'`).get().n;
if (legacyOrders > 0) {
  const renumber = db.transaction(() => {
    const all = db.prepare(`SELECT id FROM orders ORDER BY created_at, id`).all();
    let n = 1000;
    const upd = db.prepare(`UPDATE orders SET order_no = ? WHERE id = ?`);
    for (const o of all) upd.run(String(n++), o.id);
  });
  renumber();
}

// Migration: add parent_id to categories created before subcategory support
const catCols = db.prepare(`PRAGMA table_info(categories)`).all().map(c => c.name);
if (!catCols.includes('parent_id')) {
  db.pragma('foreign_keys = OFF');
  db.exec(`
    CREATE TABLE categories_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER REFERENCES categories_new(id) ON DELETE CASCADE
    );
    INSERT INTO categories_new (id, name) SELECT id, name FROM categories;
    DROP TABLE categories;
    ALTER TABLE categories_new RENAME TO categories;
  `);
  db.pragma('foreign_keys = ON');
}

// Seed a default admin account on first run
const hasAdmin = db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get().n;
if (!hasAdmin) {
  db.prepare(`INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, 'admin')`)
    .run('admin', bcrypt.hashSync('admin123', 10), 'Administrator');
  console.log('Seeded default admin account -> username: admin  password: admin123 (change it!)');
}

module.exports = db;
