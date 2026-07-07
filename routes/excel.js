const express = require('express');
const ExcelJS = require('exceljs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { snapshotCatalog, logAction } = require('../lib/history');
const { sanitizeProduct } = require('../lib/products');
const { excelUpload } = require('../lib/uploads');

const router = express.Router();

function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  wb.xlsx.write(res).then(() => res.end());
}

const PRODUCT_COLUMNS = [
  { header: 'SKU', key: 'sku', width: 16 },
  { header: 'Barcode', key: 'barcode', width: 16 },
  { header: 'Name', key: 'name', width: 32 },
  { header: 'Description', key: 'description', width: 40 },
  { header: 'Category', key: 'category_name', width: 20 },
  { header: 'Subcategory', key: 'subcategory_name', width: 20 },
  { header: 'Price', key: 'price', width: 12 },
  { header: 'Cost', key: 'cost', width: 12 },
  { header: 'Stock', key: 'stock', width: 10 },
  { header: 'Discount %', key: 'discount_pct', width: 12 },
  { header: 'VAT', key: 'vat', width: 8 },
  { header: 'Active', key: 'active', width: 10 },
  { header: 'Image URL', key: 'image', width: 45 }
];

router.get('/products/export', requireAdmin, (req, res) => {
  const rows = db.prepare(`SELECT p.*,
      CASE WHEN pc.id IS NULL THEN c.name ELSE pc.name END AS category_name,
      CASE WHEN pc.id IS NULL THEN '' ELSE c.name END AS subcategory_name
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN categories pc ON pc.id = c.parent_id
    ORDER BY p.name`).all();
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.columns = PRODUCT_COLUMNS;
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow({ ...r, active: r.active ? 'yes' : 'no', vat: r.vat ? 'yes' : 'no' }));
  sendWorkbook(res, wb, 'products.xlsx');
});

router.get('/products/template', requireAdmin, (req, res) => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Products');
  ws.columns = PRODUCT_COLUMNS;
  ws.getRow(1).font = { bold: true };
  ws.addRow({ sku: 'EXAMPLE-001', barcode: '7290000000001', name: 'Example product', description: 'Optional', category_name: 'General', subcategory_name: 'Optional sub', price: 99.9, cost: 60, stock: 25, discount_pct: 0, vat: 'yes', active: 'yes', image: 'https://example.com/photo.jpg (optional)' });
  sendWorkbook(res, wb, 'products-template.xlsx');
});

const importProductsTx = db.transaction((items) => {
  const result = { created: 0, updated: 0 };
  const findTop = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND parent_id IS NULL');
  const findSub = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND parent_id = ?');
  const insCat = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)');
  const findProd = db.prepare('SELECT id FROM products WHERE sku = ?');
  const ins = db.prepare(`INSERT INTO products (sku, name, barcode, description, category_id, price, cost, stock, discount_pct, vat, active, image, image_source)
    VALUES (@sku, @name, @barcode, @description, @category_id, @price, @cost, @stock, @discount_pct, @vat, @active, @image, @image_source)`);
  // empty barcode/image in the file means "keep what's already there", so a
  // re-import of a sheet without those columns doesn't wipe existing data
  const upd = db.prepare(`UPDATE products SET name=@name, description=@description, category_id=@category_id,
    price=@price, cost=@cost, stock=@stock, discount_pct=@discount_pct, vat=@vat, active=@active,
    barcode = CASE WHEN @barcode = '' THEN barcode ELSE @barcode END,
    image = CASE WHEN @image = '' THEN image ELSE @image END,
    image_source = CASE WHEN @image = '' THEN image_source ELSE @image_source END,
    updated_at=datetime('now') WHERE id=@id`);
  for (const item of items) {
    let category_id = null;
    if (item.category_name) {
      const top = findTop.get(item.category_name);
      const topId = top ? top.id : insCat.run(item.category_name, null).lastInsertRowid;
      category_id = topId;
      if (item.subcategory_name) {
        const sub = findSub.get(item.subcategory_name, topId);
        category_id = sub ? sub.id : insCat.run(item.subcategory_name, topId).lastInsertRowid;
      }
    }
    const image = String(item.image || '').trim();
    const p = { ...sanitizeProduct(item), category_id, image, image_source: /^https?:\/\//i.test(image) ? image : '' };
    const existing = findProd.get(p.sku);
    if (existing) { upd.run({ ...p, id: existing.id }); result.updated++; }
    else { ins.run(p); result.created++; }
  }
  return result;
});

router.post('/products/import', requireAdmin, excelUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_file' });
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) return res.status(400).json({ error: 'empty_workbook' });

    // map headers (row 1) to column indexes, case-insensitive
    const headerMap = {};
    ws.getRow(1).eachCell((cell, col) => {
      const h = String(cell.value || '').trim().toLowerCase();
      if (h) headerMap[h] = col;
    });
    const col = (row, names) => {
      for (const n of names) if (headerMap[n]) {
        const v = row.getCell(headerMap[n]).value;
        if (v && typeof v === 'object') {
          if ('result' in v) return v.result; // formula cells
          if ('hyperlink' in v) return v.hyperlink || v.text; // Excel turns URLs into hyperlink cells
          if ('richText' in v) return v.richText.map(r => r.text).join('');
        }
        return v;
      }
      return undefined;
    };

    const items = [];
    const errors = [];
    ws.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const sku = String(col(row, ['sku']) ?? '').trim();
      const name = String(col(row, ['name', 'product', 'product name']) ?? '').trim();
      if (!sku && !name) return; // skip blank rows
      if (!sku || !name) { errors.push({ row: rowNumber, error: 'sku_and_name_required' }); return; }
      items.push({
        sku, name,
        barcode: String(col(row, ['barcode']) ?? '').trim(),
        image: String(col(row, ['image url', 'image']) ?? '').trim(),
        description: String(col(row, ['description']) ?? ''),
        category_name: String(col(row, ['category']) ?? '').trim(),
        subcategory_name: String(col(row, ['subcategory', 'sub category']) ?? '').trim(),
        price: col(row, ['price']),
        cost: col(row, ['cost']),
        stock: col(row, ['stock', 'quantity', 'qty']),
        discount_pct: col(row, ['discount %', 'discount', 'discount_pct']),
        vat: /^(no|0|false)$/i.test(String(col(row, ['vat']) ?? 'yes').trim()) ? 0 : 1,
        active: /^(no|0|false)$/i.test(String(col(row, ['active']) ?? 'yes').trim()) ? 0 : 1
      });
    });
    if (items.length === 0) return res.status(400).json({ error: 'no_valid_rows', errors });
    const snap = snapshotCatalog();
    const result = importProductsTx(items);
    logAction(req.session.user, 'excel_import', `${req.file.originalname}: ${result.created} + ${result.updated}`, snap);
    res.json({ ...result, errors });
  } catch (e) {
    console.error('Excel import failed:', e);
    res.status(400).json({ error: 'parse_failed' });
  }
});

router.get('/orders/export', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  const { from, to, status } = req.query;
  let where = 'WHERE 1=1';
  const params = [];
  if (!isAdmin) { where += ' AND o.agent_id = ?'; params.push(req.session.user.id); }
  else if (req.query.agent_id) { where += ' AND o.agent_id = ?'; params.push(req.query.agent_id); }
  if (status) { where += ' AND o.status = ?'; params.push(status); }
  if (from) { where += ` AND date(o.created_at) >= date(?)`; params.push(from); }
  if (to) { where += ` AND date(o.created_at) <= date(?)`; params.push(to); }

  const rows = db.prepare(`SELECT o.order_no, o.created_at, u.name AS agent, o.customer_name, o.customer_phone,
      o.status, i.product_name, i.sku, i.qty, i.unit_price, i.discount_pct, i.line_total, o.total AS order_total, o.notes
    FROM orders o JOIN users u ON u.id = o.agent_id JOIN order_items i ON i.order_id = o.id
    ${where} ORDER BY o.created_at DESC, o.id, i.id`).all(...params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Orders');
  ws.columns = [
    { header: 'Order #', key: 'order_no', width: 20 },
    { header: 'Date', key: 'created_at', width: 20 },
    { header: 'Agent', key: 'agent', width: 20 },
    { header: 'Customer', key: 'customer_name', width: 20 },
    { header: 'Phone', key: 'customer_phone', width: 15 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Product', key: 'product_name', width: 32 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Qty', key: 'qty', width: 8 },
    { header: 'Unit Price', key: 'unit_price', width: 12 },
    { header: 'Discount %', key: 'discount_pct', width: 12 },
    { header: 'Line Total', key: 'line_total', width: 12 },
    { header: 'Order Total', key: 'order_total', width: 12 },
    { header: 'Notes', key: 'notes', width: 30 }
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow(r));
  sendWorkbook(res, wb, 'orders.xlsx');
});

router.get('/customers/export', requireAuth, (req, res) => {
  const isAdmin = req.session.user.role === 'admin';
  let sql = `SELECT c.name, c.phone, c.address, c.notes, c.created_at,
      COUNT(o.id) AS order_count, COALESCE(SUM(o.total),0) AS revenue,
      COALESCE(AVG(o.total),0) AS avg_order, MAX(o.created_at) AS last_order
    FROM customers c
    LEFT JOIN orders o ON o.customer_id = c.id AND o.status != 'cancelled'`;
  const params = [];
  if (!isAdmin) { sql += ' AND o.agent_id = ?'; params.push(req.session.user.id); }
  sql += ' GROUP BY c.id ORDER BY revenue DESC';
  const rows = db.prepare(sql).all(...params);

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Customers');
  ws.columns = [
    { header: 'Name', key: 'name', width: 24 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Orders', key: 'order_count', width: 10 },
    { header: 'Revenue', key: 'revenue', width: 14 },
    { header: 'Avg Order', key: 'avg_order', width: 12 },
    { header: 'Last Order', key: 'last_order', width: 20 },
    { header: 'Created', key: 'created_at', width: 20 }
  ];
  ws.getRow(1).font = { bold: true };
  rows.forEach(r => ws.addRow({ ...r, avg_order: Math.round(r.avg_order * 100) / 100 }));
  sendWorkbook(res, wb, 'customers.xlsx');
});

module.exports = router;
