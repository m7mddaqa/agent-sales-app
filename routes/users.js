const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT id, username, name, phone, role, active, created_at FROM users ORDER BY name').all());
});

router.post('/', requireAdmin, (req, res) => {
  const { username, password, name, phone, role } = req.body || {};
  if (!username || !password || !name) return res.status(400).json({ error: 'missing_fields' });
  if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  try {
    const info = db.prepare('INSERT INTO users (username, password_hash, name, phone, role) VALUES (?, ?, ?, ?, ?)')
      .run(String(username).trim(), bcrypt.hashSync(String(password), 10), String(name).trim(), String(phone || ''), role === 'admin' ? 'admin' : 'agent');
    res.json(db.prepare('SELECT id, username, name, phone, role, active FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    res.status(400).json({ error: 'duplicate_username' });
  }
});

router.put('/:id', requireAdmin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const { name, phone, role, active, password } = req.body || {};
  db.prepare('UPDATE users SET name = ?, phone = ?, role = ?, active = ? WHERE id = ?').run(
    String(name || u.name), String(phone ?? u.phone),
    role === 'admin' || role === 'agent' ? role : u.role,
    active === 0 || active === false ? 0 : 1, u.id
  );
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'password_too_short' });
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(String(password), 10), u.id);
  }
  res.json({ ok: true });
});

module.exports = router;
