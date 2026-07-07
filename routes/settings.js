const express = require('express');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

function getSetting(key, fallback) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function vatRate() {
  const r = Number(getSetting('vat_rate', 18));
  return Number.isFinite(r) && r >= 0 ? r : 18;
}

router.get('/', requireAuth, (req, res) => {
  res.json({ vat_rate: vatRate() });
});

router.put('/', requireAdmin, (req, res) => {
  const r = Number(req.body.vat_rate);
  if (!Number.isFinite(r) || r < 0 || r > 100) return res.status(400).json({ error: 'bad_vat_rate' });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('vat_rate', String(r));
  res.json({ vat_rate: vatRate() });
});

module.exports = router;
