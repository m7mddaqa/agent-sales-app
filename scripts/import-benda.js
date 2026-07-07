// One-off import of the Benda supplier catalog CSV into the app database.
// Usage: node scripts/import-benda.js [path-to-csv]
const db = require('../db');
const { parseCSVFile } = require('./parse-csv');

const file = process.argv[2] || 'C:/Users/Mohamad/Downloads/(final)benda_products_with_combined_specs.csv';
const items = parseCSVFile(file);
console.log('Parsed rows:', items.length);

const decodeEntities = s => s
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');

const findCat = db.prepare('SELECT id FROM categories WHERE name = ? COLLATE NOCASE AND parent_id IS NULL');
const insCat = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, NULL)');
const findProd = db.prepare('SELECT id FROM products WHERE sku = ?');
const ins = db.prepare(`INSERT INTO products (sku, name, barcode, description, category_id, price, cost, stock, discount_pct, vat, active, image, image_source)
  VALUES (@sku, @name, @barcode, @description, @category_id, @price, 0, @stock, 0, 1, 1, @image, @image_source)`);
const upd = db.prepare(`UPDATE products SET name=@name, barcode=@barcode, description=@description, category_id=@category_id,
  price=@price, stock=@stock, image=@image, image_source=@image_source, updated_at=datetime('now') WHERE id=@id`);

const run = db.transaction(() => {
  const result = { created: 0, updated: 0, newCategories: 0 };
  const catCache = new Map();
  for (const it of items) {
    const sku = it.sku.trim();
    const name = it.name.trim();
    if (!sku || !name) continue;

    let category_id = null;
    const catName = decodeEntities(it.category || '').trim();
    if (catName && catName.toLowerCase() !== 'uncategorized') {
      if (catCache.has(catName)) category_id = catCache.get(catName);
      else {
        const found = findCat.get(catName);
        category_id = found ? found.id : insCat.run(catName).lastInsertRowid;
        if (!found) result.newCategories++;
        catCache.set(catName, category_id);
      }
    }

    const image = [it.image_01, it.image_02, it.image_03].map(s => (s || '').trim()).find(Boolean) || '';
    const p = {
      sku, name,
      barcode: (it.barcode || '').trim(),
      description: (it.combined_specs || '').trim(),
      category_id,
      price: Math.max(0, Number(it.price) || 0),
      stock: Math.max(0, Math.round(Number(it.stock) || 0)),
      image,
      image_source: image
    };
    const existing = findProd.get(sku);
    if (existing) { upd.run({ ...p, id: existing.id }); result.updated++; }
    else { ins.run(p); result.created++; }
  }
  return result;
});

console.log('Result:', run());
console.log('Totals now:', db.prepare('SELECT COUNT(*) n FROM products').get().n, 'products,',
  db.prepare('SELECT COUNT(*) n FROM categories').get().n, 'categories');
