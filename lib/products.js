// Shared product helpers used by the products routes and the Excel import.

function productQuery({ search, category_id, in_stock, active, sort, dir }) {
  let sql = `SELECT p.*,
    CASE WHEN pc.id IS NULL THEN c.name ELSE pc.name || ' › ' || c.name END AS category_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    WHERE 1=1`;
  const params = [];
  if (active !== 'all') { sql += ' AND p.active = 1'; }
  if (search) { sql += ' AND (p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)'; const s = `%${search}%`; params.push(s, s, s, s); }
  if (category_id) {
    // a top-level category also matches products in its subcategories
    sql += ' AND (p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_id = ?))';
    params.push(category_id, category_id);
  }
  if (in_stock === '1') { sql += ' AND p.stock > 0'; }
  if (in_stock === '0') { sql += ' AND p.stock <= 0'; }
  const sortCols = { name: 'p.name', price: 'p.price', stock: 'p.stock', sku: 'p.sku', created: 'p.created_at', category: 'category_name' };
  const col = sortCols[sort] || 'p.name';
  const direction = dir === 'desc' ? 'DESC' : 'ASC';
  sql += ` ORDER BY ${col} COLLATE NOCASE ${direction}`;
  return { sql, params };
}

function sanitizeProduct(body) {
  return {
    sku: String(body.sku || '').trim(),
    name: String(body.name || '').trim(),
    barcode: String(body.barcode || '').trim(),
    description: String(body.description || '').trim(),
    category_id: body.category_id ? Number(body.category_id) : null,
    price: Math.max(0, Number(body.price) || 0),
    cost: Math.max(0, Number(body.cost) || 0),
    stock: Math.max(0, Math.round(Number(body.stock) || 0)),
    discount_pct: Math.min(100, Math.max(0, Number(body.discount_pct) || 0)),
    vat: body.vat === 0 || body.vat === false ? 0 : 1,
    active: body.active === 0 || body.active === false ? 0 : 1
  };
}

module.exports = { productQuery, sanitizeProduct };
