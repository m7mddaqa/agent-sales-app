# Agent Sales App

Order management web app for sales agents: product catalog, orders with per-line price/discount adjustment, live stock, reports, admin panel, and Excel import/export. Mobile-friendly, with an English / العربية / עברית language switcher (full RTL support).

## Run it

```
npm install
npm start
```

Open http://localhost:3000

**Default admin login:** `admin` / `admin123` — change the password right after first login (click your name in the top bar).

## Project structure

```
server.js            app setup: session, static files, route mounting
db.js                SQLite connection, schema and migrations
middleware/auth.js   requireAuth / requireAdmin guards
lib/                 shared helpers (uploads, product queries, undo history)
routes/              one file per API area: auth, products, orders, customers,
                     categories, users, reports, excel, settings, actions
public/
  index.html         SPA shell (Vue 3, no build step)
  css/               base, layout, components, catalog, reports, mobile
  js/
    helpers.js       fetch wrapper + small utilities
    i18n/            en / ar / he translations
    mixins/          catalog, orders, customers, reports, admin
    app.js           root component: auth, language, navigation
scripts/             one-off CLI utilities (catalog import, db stats)
```

The frontend is plain Vue 3 (global build, vendored) organized with mixins — no bundler needed; the server serves `public/` as-is.

## Roles

| | Agent | Admin |
|---|---|---|
| Browse/filter/sort products, see stock | ✅ | ✅ |
| Place orders, adjust price & discount per line | ✅ | ✅ |
| Edit / cancel orders | own, while **pending** | any order, any status |
| See product cost | ❌ | ✅ |
| Reports | own sales | all agents, filterable |
| Manage products, images, categories & subcategories, users | ❌ | ✅ |
| Excel product import/export | ❌ | ✅ |
| Excel orders export | own orders | all orders |

## Order lifecycle

Orders get sequential numbers starting at **#1000**. Flow: `pending → approved → delivered`, or `cancelled` at any point (stock is automatically restored on cancel, and cancelling asks for confirmation). Admin can **reopen a cancelled order** by changing its status back — stock is re-reserved (fails if no longer available). Stock is reserved when an order is placed and adjusted when an order is edited.

## Customers

Orders are linked to customer records. When placing an order, agents pick an existing customer or type a new name (auto-created). The **Customers** page shows the shared customer base with per-customer statistics — order count, total spent, average order, last order — and each customer profile shows top purchased products plus full order history (agents see their own orders; admin sees everything). Admin can edit/delete customers; everyone can add and export the list to Excel. Reports include a Top Customers breakdown.

## Excel

Admin → Excel tab:
- **Products export** — full list to `.xlsx`.
- **Products import** — rows are matched by SKU: existing SKUs are updated, new ones are created. Unknown categories/subcategories are auto-created. Download the template to see the expected columns (SKU, Barcode, Name, Description, Category, Subcategory, Price, Cost, Stock, Discount %, VAT, Active, Image URL). An empty Barcode/Image URL cell keeps the existing value, so re-imports don't wipe data. Image URL can point to any web image (`https://...`) and is shown directly in the catalog.
- **Orders export** — one row per order line, filterable by date/status/agent (also available from the Orders and Reports pages).

Imports are logged in Admin → History and can be undone.

## Categories

Two levels: **category → subcategory** (managed in Admin → Categories as a tree). Filtering the catalog by a category also shows products from its subcategories; product listings display the full path (e.g. *Beverages › Soft Drinks*). Deleting a category removes its subcategories and leaves affected products uncategorized.

## History & undo

Admin → History lists every catalog-changing action (product create/update/delete, image change, category changes, Excel imports, undos) with who did it and when. Recent actions keep a full compressed snapshot of the catalog, so they can be **undone** with one click — products and categories are restored to the state before the action. The last 100 actions are listed; the 20 most recent are undoable.

## Large catalogs

The catalog and admin product table load 60 products at a time with a "Show more" button; search and filters run server-side over the full catalog (name, SKU, barcode, and description). The one-off `scripts/import-benda.js` script imported the Benda supplier CSV (~3,800 products, 142 categories, barcodes and CDN image URLs).

## Data & backups

Everything lives in two folders:
- `data/app.db` — SQLite database
- `uploads/` — product images

Back up = copy those two. To reset the app, delete them and restart.

## Deploying on a VPS

```
PORT=3000 SESSION_SECRET=some-long-random-string node server.js
```

Set `SESSION_SECRET` so logins survive restarts, and put it behind a reverse proxy (Caddy/nginx) with HTTPS. Any process manager works (`pm2 start server.js`).
