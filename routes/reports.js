const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/summary', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const { from, to } = req.query;
  const agentFilter = isAdmin ? (req.query.agent_id || null) : req.session.user.id;

  let where = `WHERE o.status != 'cancelled'`;
  const params = [];
  if (agentFilter) { where += ' AND o.agent_id = ?'; params.push(agentFilter); }
  if (from) { where += ` AND date(o.created_at) >= date(?)`; params.push(from); }
  if (to) { where += ` AND date(o.created_at) <= date(?)`; params.push(to); }

  const totals = db.prepare(`SELECT COUNT(*) AS order_count, COALESCE(SUM(o.total),0) AS revenue,
    COALESCE(AVG(o.total),0) AS avg_order FROM orders o ${where}`).get(...params);

  const byStatus = db.prepare(`SELECT o.status, COUNT(*) AS n, COALESCE(SUM(o.total),0) AS revenue
    FROM orders o ${where} GROUP BY o.status`).all(...params);

  const byDay = db.prepare(`SELECT date(o.created_at) AS day, COUNT(*) AS n, COALESCE(SUM(o.total),0) AS revenue
    FROM orders o ${where} GROUP BY day ORDER BY day`).all(...params);

  const byAgent = isAdmin && !agentFilter
    ? db.prepare(`SELECT u.name AS agent, COUNT(*) AS n, COALESCE(SUM(o.total),0) AS revenue
        FROM orders o JOIN users u ON u.id = o.agent_id ${where} GROUP BY o.agent_id ORDER BY revenue DESC`).all(...params)
    : [];

  const byProduct = db.prepare(`SELECT i.product_name AS product, i.sku, SUM(i.qty) AS qty, COALESCE(SUM(i.line_total),0) AS revenue
    FROM order_items i JOIN orders o ON o.id = i.order_id ${where}
    GROUP BY i.sku, i.product_name ORDER BY revenue DESC LIMIT 50`).all(...params);

  const byCustomer = db.prepare(`SELECT COALESCE(c.name, NULLIF(o.customer_name, ''), '—') AS customer,
      COUNT(*) AS n, COALESCE(SUM(o.total),0) AS revenue
    FROM orders o LEFT JOIN customers c ON c.id = o.customer_id ${where}
    GROUP BY COALESCE('c' || c.id, o.customer_name) ORDER BY revenue DESC LIMIT 20`).all(...params);

  res.json({ totals, byStatus, byDay, byAgent, byProduct, byCustomer });
});

module.exports = router;
