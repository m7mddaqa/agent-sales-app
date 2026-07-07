const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function lineTotal(qty, unitPrice, discountPct) {
  return Math.round(qty * unitPrice * (1 - discountPct / 100) * 100) / 100;
}

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'no_items' };
  const clean = [];
  for (const it of items) {
    const qty = Math.round(Number(it.qty));
    const unit_price = Number(it.unit_price);
    const discount_pct = Math.min(100, Math.max(0, Number(it.discount_pct) || 0));
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(it.product_id);
    if (!product) return { error: 'product_not_found', product_id: it.product_id };
    if (!Number.isFinite(qty) || qty <= 0) return { error: 'bad_qty', product_id: it.product_id };
    if (!Number.isFinite(unit_price) || unit_price < 0) return { error: 'bad_price', product_id: it.product_id };
    clean.push({ product, qty, unit_price, discount_pct });
  }
  return { clean };
}

// find the customer by id, or find-or-create by name+phone; null when no customer info given
function resolveCustomer(body) {
  if (body.customer_id) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(body.customer_id);
    if (c) return c;
  }
  const name = String(body.customer_name || '').trim();
  const phone = String(body.customer_phone || '').trim();
  if (!name) return null;
  const existing = db.prepare('SELECT * FROM customers WHERE name = ? COLLATE NOCASE AND phone = ?').get(name, phone);
  if (existing) return existing;
  const id = db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?)').run(name, phone).lastInsertRowid;
  return db.prepare('SELECT * FROM customers WHERE id = ?').get(id);
}

function getOrderFull(id) {
  const order = db.prepare(`SELECT o.*, u.name AS agent_name FROM orders o JOIN users u ON u.id = o.agent_id WHERE o.id = ?`).get(id);
  if (!order) return null;
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(id);
  return order;
}

function insufficientStock(productName) {
  const err = new Error('insufficient_stock');
  err.code = 'insufficient_stock';
  err.product = productName;
  return err;
}

const createOrderTx = db.transaction((agentId, body, clean) => {
  let total = 0;
  for (const it of clean) {
    if (it.product.stock < it.qty) throw insufficientStock(it.product.name);
  }
  const orderNo = String(Math.max(
    db.prepare(`SELECT COALESCE(MAX(CAST(order_no AS INTEGER)), 999) + 1 AS n FROM orders`).get().n, 1000));
  const customer = resolveCustomer(body);
  const info = db.prepare(`INSERT INTO orders (order_no, agent_id, customer_id, customer_name, customer_phone, notes) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(orderNo, agentId, customer ? customer.id : null,
         customer ? customer.name : String(body.customer_name || ''),
         customer ? customer.phone : String(body.customer_phone || ''),
         String(body.notes || ''));
  const orderId = info.lastInsertRowid;
  const insItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, sku, qty, unit_price, discount_pct, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  for (const it of clean) {
    const lt = lineTotal(it.qty, it.unit_price, it.discount_pct);
    total += lt;
    insItem.run(orderId, it.product.id, it.product.name, it.product.sku, it.qty, it.unit_price, it.discount_pct, lt);
    decStock.run(it.qty, it.product.id);
  }
  db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(Math.round(total * 100) / 100, orderId);
  return orderId;
});

const updateOrderTx = db.transaction((order, body, clean, customer) => {
  // restore stock from old items, then apply new items
  const oldItems = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  const addStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const it of oldItems) if (it.product_id) addStock.run(it.qty, it.product_id);

  db.prepare('DELETE FROM order_items WHERE order_id = ?').run(order.id);
  const insItem = db.prepare(`INSERT INTO order_items (order_id, product_id, product_name, sku, qty, unit_price, discount_pct, line_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  let total = 0;
  for (const it of clean) {
    const fresh = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(it.product.id);
    if (fresh.stock < it.qty) throw insufficientStock(fresh.name);
    const lt = lineTotal(it.qty, it.unit_price, it.discount_pct);
    total += lt;
    insItem.run(order.id, it.product.id, it.product.name, it.product.sku, it.qty, it.unit_price, it.discount_pct, lt);
    db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?').run(it.qty, it.product.id);
  }
  db.prepare(`UPDATE orders SET customer_id = ?, customer_name = ?, customer_phone = ?, notes = ?, total = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(customer ? customer.id : order.customer_id,
         customer ? customer.name : String(body.customer_name ?? order.customer_name),
         customer ? customer.phone : String(body.customer_phone ?? order.customer_phone),
         String(body.notes ?? order.notes), Math.round(total * 100) / 100, order.id);
});

const cancelRestockTx = db.transaction((orderId) => {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  const addStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  for (const it of items) if (it.product_id) addStock.run(it.qty, it.product_id);
});

// reopening a cancelled order re-reserves its stock (fails if no longer available)
const reopenReserveTx = db.transaction((orderId) => {
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  for (const it of items) {
    if (!it.product_id) continue;
    const p = db.prepare('SELECT stock, name FROM products WHERE id = ?').get(it.product_id);
    if (!p || p.stock < it.qty) throw insufficientStock(p ? p.name : it.product_name);
  }
  const dec = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
  for (const it of items) if (it.product_id) dec.run(it.qty, it.product_id);
});

router.post('/', requireAuth, (req, res) => {
  const { error, product_id, clean } = validateItems(req.body.items);
  if (error) return res.status(400).json({ error, product_id });
  try {
    const orderId = createOrderTx(req.session.user.id, req.body, clean);
    res.json(getOrderFull(orderId));
  } catch (e) {
    if (e.code === 'insufficient_stock') return res.status(400).json({ error: 'insufficient_stock', product: e.product });
    throw e;
  }
});

router.get('/', requireAuth, (req, res) => {
  const { status, agent_id, from, to, search, sort, dir } = req.query;
  let sql = `SELECT o.*, u.name AS agent_name,
    (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
    FROM orders o JOIN users u ON u.id = o.agent_id WHERE 1=1`;
  const params = [];
  if (req.session.user.role !== 'admin') { sql += ' AND o.agent_id = ?'; params.push(req.session.user.id); }
  else if (agent_id) { sql += ' AND o.agent_id = ?'; params.push(agent_id); }
  if (status) { sql += ' AND o.status = ?'; params.push(status); }
  if (from) { sql += ` AND date(o.created_at) >= date(?)`; params.push(from); }
  if (to) { sql += ` AND date(o.created_at) <= date(?)`; params.push(to); }
  if (search) { sql += ' AND (o.order_no LIKE ? OR o.customer_name LIKE ?)'; const s = `%${search}%`; params.push(s, s); }
  const sortCols = { created: 'o.created_at', total: 'o.total', status: 'o.status', agent: 'agent_name' };
  sql += ` ORDER BY ${sortCols[sort] || 'o.created_at'} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireAuth, (req, res) => {
  const order = getOrderFull(req.params.id);
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (req.session.user.role !== 'admin' && order.agent_id !== req.session.user.id) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(order);
});

router.put('/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not_found' });
  const isAdmin = req.session.user.role === 'admin';
  if (!isAdmin && order.agent_id !== req.session.user.id) return res.status(403).json({ error: 'forbidden' });
  // agents may only edit their own pending orders; admin can edit any non-cancelled order
  if (!isAdmin && order.status !== 'pending') return res.status(400).json({ error: 'only_pending_editable' });

  const { status } = req.body;

  // cancelled orders: admin may reopen them (stock is re-reserved); nothing else is editable
  if (order.status === 'cancelled') {
    if (!isAdmin || !status || status === 'cancelled') return res.status(400).json({ error: 'order_cancelled' });
    try {
      reopenReserveTx(order.id);
    } catch (e) {
      if (e.code === 'insufficient_stock') return res.status(400).json({ error: 'insufficient_stock', product: e.product });
      throw e;
    }
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, order.id);
    return res.json(getOrderFull(order.id));
  }

  // status change
  if (status && status !== order.status) {
    const allowed = isAdmin ? ['pending', 'approved', 'delivered', 'cancelled'] : ['cancelled'];
    if (!allowed.includes(status)) return res.status(403).json({ error: 'status_not_allowed' });
    if (status === 'cancelled') cancelRestockTx(order.id);
    db.prepare(`UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(status, order.id);
    if (status === 'cancelled') return res.json(getOrderFull(order.id));
    order.status = status;
  }

  // customer change (by id, or by name/phone which finds-or-creates)
  let customer = null;
  if (req.body.customer_id || req.body.customer_name !== undefined) {
    customer = resolveCustomer(req.body);
  }

  // item edits
  if (req.body.items) {
    const { error, product_id, clean } = validateItems(req.body.items);
    if (error) return res.status(400).json({ error, product_id });
    try {
      updateOrderTx(order, req.body, clean, customer);
    } catch (e) {
      if (e.code === 'insufficient_stock') return res.status(400).json({ error: 'insufficient_stock', product: e.product });
      throw e;
    }
  } else if (customer || req.body.customer_name !== undefined || req.body.customer_phone !== undefined || req.body.notes !== undefined) {
    db.prepare(`UPDATE orders SET customer_id = ?, customer_name = ?, customer_phone = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(customer ? customer.id : order.customer_id,
           customer ? customer.name : String(req.body.customer_name ?? order.customer_name),
           customer ? customer.phone : String(req.body.customer_phone ?? order.customer_phone),
           String(req.body.notes ?? order.notes), order.id);
  }
  res.json(getOrderFull(order.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'not_found' });
  if (order.status !== 'cancelled') cancelRestockTx(order.id);
  db.prepare('DELETE FROM orders WHERE id = ?').run(order.id);
  res.json({ ok: true });
});

module.exports = router;
