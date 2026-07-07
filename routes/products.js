const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { snapshotCatalog, logAction } = require('../lib/history');
const { productQuery, sanitizeProduct } = require('../lib/products');
const { imageUpload } = require('../lib/uploads');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const q = { ...req.query };
  if (req.session.user.role !== 'admin') q.active = undefined; // agents only see active products
  const { sql, params } = productQuery(q);
  const limit = req.query.limit ? Math.min(500, Math.max(1, Number(req.query.limit) || 1)) : 0;
  let rows;
  let total = null;
  if (limit) {
    total = db.prepare(`SELECT COUNT(*) AS n FROM (${sql})`).get(...params).n;
    const offset = Math.max(0, Number(req.query.offset) || 0);
    rows = db.prepare(sql + ' LIMIT ? OFFSET ?').all(...params, limit, offset);
  } else {
    rows = db.prepare(sql).all(...params);
  }
  if (req.session.user.role !== 'admin') rows = rows.map(({ cost, ...r }) => r); // hide cost from agents
  // paged shape only when limit was requested, so existing full-list callers keep working
  res.json(total === null ? rows : { items: rows, total });
});

router.post('/', requireAdmin, (req, res) => {
  const p = sanitizeProduct(req.body);
  if (!p.sku || !p.name) return res.status(400).json({ error: 'sku_and_name_required' });
  const snap = snapshotCatalog();
  try {
    const info = db.prepare(`INSERT INTO products (sku, name, barcode, description, category_id, price, cost, stock, discount_pct, vat, active)
      VALUES (@sku, @name, @barcode, @description, @category_id, @price, @cost, @stock, @discount_pct, @vat, @active)`).run(p);
    logAction(req.session.user, 'product_create', `${p.sku} — ${p.name}`, snap);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'duplicate_sku' });
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const p = sanitizeProduct({ ...existing, ...req.body });
  if (!p.sku || !p.name) return res.status(400).json({ error: 'sku_and_name_required' });
  const snap = snapshotCatalog();
  try {
    db.prepare(`UPDATE products SET sku=@sku, name=@name, barcode=@barcode, description=@description, category_id=@category_id,
      price=@price, cost=@cost, stock=@stock, discount_pct=@discount_pct, vat=@vat, active=@active, updated_at=datetime('now')
      WHERE id=@id`).run({ ...p, id: existing.id });
    logAction(req.session.user, 'product_update', `${p.sku} — ${p.name}`, snap);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id));
  } catch (e) {
    res.status(400).json({ error: 'duplicate_sku' });
  }
});

router.delete('/:id', requireAdmin, (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not_found' });
  const snap = snapshotCatalog();
  const used = db.prepare('SELECT COUNT(*) AS n FROM order_items WHERE product_id = ?').get(p.id).n;
  if (used > 0) {
    // keep history intact: deactivate instead of deleting
    db.prepare(`UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?`).run(p.id);
    logAction(req.session.user, 'product_deactivate', `${p.sku} — ${p.name}`, snap);
    return res.json({ ok: true, deactivated: true });
  }
  db.prepare('DELETE FROM products WHERE id = ?').run(p.id);
  logAction(req.session.user, 'product_delete', `${p.sku} — ${p.name}`, snap);
  res.json({ ok: true }); // image files are kept on disk so undo can restore them
});

router.post('/:id/image', requireAdmin, imageUpload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  const old = db.prepare('SELECT sku, name, image FROM products WHERE id = ?').get(req.params.id);
  if (!old) return res.status(404).json({ error: 'not_found' });
  const snap = snapshotCatalog();
  const rel = '/uploads/' + req.file.filename;
  db.prepare(`UPDATE products SET image = ?, image_source = '', updated_at = datetime('now') WHERE id = ?`).run(rel, req.params.id);
  logAction(req.session.user, 'product_image', `${old.sku} — ${old.name}`, snap);
  res.json({ image: rel }); // old image file stays on disk so undo can restore it
});

module.exports = router;
