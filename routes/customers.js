// Agents see the shared customer base, but stats/history only cover their own orders.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const { search, sort, dir } = req.query;
  let sql = `SELECT c.*,
      COUNT(o.id) AS order_count,
      COALESCE(SUM(o.total), 0) AS revenue,
      MAX(o.created_at) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'`;
  const params = [];
  if (!isAdmin) { sql += ' AND o.agent_id = ?'; params.push(req.session.user.id); }
  sql += ' WHERE 1=1';
  if (search) { sql += ' AND (c.name LIKE ? OR c.phone LIKE ?)'; const s = `%${search}%`; params.push(s, s); }
  sql += ' GROUP BY c.id';
  const sortCols = { name: 'c.name COLLATE NOCASE', orders: 'order_count', revenue: 'revenue', last: 'last_order' };
  sql += ` ORDER BY ${sortCols[sort] || 'c.name COLLATE NOCASE'} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  res.json(db.prepare(sql).all(...params));
});

router.get('/:id', requireAuth, (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) return res.status(404).json({ error: 'not_found' });
  const isAdmin = req.session.user.role === 'admin';
  let cond = 'WHERE o.customer_id = ?';
  const params = [customer.id];
  if (!isAdmin) { cond += ' AND o.agent_id = ?'; params.push(req.session.user.id); }

  const orders = db.prepare(`SELECT o.*, u.name AS agent_name,
      (SELECT COUNT(*) FROM order_items i WHERE i.order_id = o.id) AS item_count
    FROM orders o JOIN users u ON u.id = o.agent_id ${cond} ORDER BY o.created_at DESC`).all(...params);

  const active = `AND o.status != 'cancelled'`;
  const stats = db.prepare(`SELECT COUNT(*) AS order_count, COALESCE(SUM(o.total),0) AS revenue,
      COALESCE(AVG(o.total),0) AS avg_order, MAX(o.created_at) AS last_order
    FROM orders o ${cond} ${active}`).get(...params);

  const topProducts = db.prepare(`SELECT i.product_name AS product, i.sku, SUM(i.qty) AS qty,
      COALESCE(SUM(i.line_total),0) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id ${cond} ${active}
    GROUP BY i.sku, i.product_name ORDER BY revenue DESC LIMIT 10`).all(...params);

  res.json({ customer, orders, stats, topProducts });
});

router.post('/', requireAuth, (req, res) => {
  const name = String(req.body.name || '').trim();
  const phone = String(req.body.phone || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (db.prepare('SELECT id FROM customers WHERE name = ? COLLATE NOCASE AND phone = ?').get(name, phone)) {
    return res.status(400).json({ error: 'duplicate_name' });
  }
  const info = db.prepare('INSERT INTO customers (name, phone, address, notes) VALUES (?, ?, ?, ?)')
    .run(name, phone, String(req.body.address || ''), String(req.body.notes || ''));
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', requireAdmin, (req, res) => {
  const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'not_found' });
  const name = String(req.body.name ?? c.name).trim();
  const phone = String(req.body.phone ?? c.phone).trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  db.prepare('UPDATE customers SET name = ?, phone = ?, address = ?, notes = ? WHERE id = ?')
    .run(name, phone, String(req.body.address ?? c.address), String(req.body.notes ?? c.notes), c.id);
  // keep order snapshots consistent with the customer record
  db.prepare('UPDATE orders SET customer_name = ?, customer_phone = ? WHERE customer_id = ?').run(name, phone, c.id);
  res.json(db.prepare('SELECT * FROM customers WHERE id = ?').get(c.id));
});

router.delete('/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM customers WHERE id = ?').run(req.params.id); // orders keep their snapshot, customer_id nulls
  res.json({ ok: true });
});

module.exports = router;
