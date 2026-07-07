// Categories are a 2-level tree: category -> subcategory.
const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { snapshotCatalog, logAction } = require('../lib/history');

const router = express.Router();

function categoryNameTaken(name, parentId, excludeId) {
  const row = parentId
    ? db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND parent_id = ?').get(name, parentId)
    : db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND parent_id IS NULL').get(name);
  return row && row.id !== excludeId;
}

router.get('/', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM categories ORDER BY name COLLATE NOCASE').all());
});

router.post('/', requireAdmin, (req, res) => {
  const name = String(req.body.name || '').trim();
  const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (parentId) {
    const parent = db.prepare('SELECT * FROM categories WHERE id = ?').get(parentId);
    if (!parent) return res.status(400).json({ error: 'parent_not_found' });
    if (parent.parent_id) return res.status(400).json({ error: 'max_depth' }); // only 2 levels
  }
  if (categoryNameTaken(name, parentId)) return res.status(400).json({ error: 'duplicate_name' });
  const snap = snapshotCatalog();
  const info = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)').run(name, parentId);
  logAction(req.session.user, 'category_create', name, snap);
  res.json(db.prepare('SELECT * FROM categories WHERE id = ?').get(info.lastInsertRowid));
});

router.put('/:id', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not_found' });
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name_required' });
  if (categoryNameTaken(name, cat.parent_id, cat.id)) return res.status(400).json({ error: 'duplicate_name' });
  const snap = snapshotCatalog();
  db.prepare('UPDATE categories SET name = ? WHERE id = ?').run(name, cat.id);
  logAction(req.session.user, 'category_rename', `${cat.name} → ${name}`, snap);
  res.json({ ok: true });
});

router.delete('/:id', requireAdmin, (req, res) => {
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
  if (!cat) return res.status(404).json({ error: 'not_found' });
  const snap = snapshotCatalog();
  db.prepare('DELETE FROM categories WHERE id = ?').run(cat.id); // subcategories cascade, products unlink
  logAction(req.session.user, 'category_delete', cat.name, snap);
  res.json({ ok: true });
});

module.exports = router;
