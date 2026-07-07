const db = require('../db');
console.log('products:', db.prepare('SELECT COUNT(*) n FROM products').get().n);
console.log("with image:", db.prepare("SELECT COUNT(*) n FROM products WHERE image != ''").get().n);
console.log("with image_source:", db.prepare("SELECT COUNT(*) n FROM products WHERE image_source != ''").get().n);
console.log('categories:', db.prepare('SELECT COUNT(*) n FROM categories').get().n);
console.log('orders:', db.prepare('SELECT COUNT(*) n FROM orders').get().n);
console.log('users:', db.prepare('SELECT COUNT(*) n FROM users').get().n);
console.log('sample products:', JSON.stringify(db.prepare('SELECT sku,name,price,stock,image,image_source FROM products LIMIT 5').all(), null, 1));
console.log('categories list:', JSON.stringify(db.prepare('SELECT id,name,parent_id FROM categories').all()));
