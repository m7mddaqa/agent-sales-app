const express = require('express');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');
const { snapshotCatalog, logAction, restoreCatalog } = require('../lib/history');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  res.json(db.prepare(`SELECT id, user_name, type, description, undone, created_at,
    CASE WHEN undone = 0 AND LENGTH(snapshot) > 0 THEN 1 ELSE 0 END AS undoable
    FROM actions ORDER BY id DESC LIMIT 50`).all());
});

router.post('/:id/undo', requireAdmin, (req, res) => {
  const action = db.prepare('SELECT * FROM actions WHERE id = ?').get(req.params.id);
  if (!action) return res.status(404).json({ error: 'not_found' });
  if (!action.snapshot) return res.status(400).json({ error: 'not_undoable' });
  const before = snapshotCatalog();
  restoreCatalog(action.snapshot);
  db.prepare('UPDATE actions SET undone = 1 WHERE id = ?').run(action.id);
  logAction(req.session.user, 'undo', `#${action.id} ${action.type}: ${action.description}`, before);
  res.json({ ok: true });
});

module.exports = router;
