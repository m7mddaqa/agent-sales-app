// Product catalog + shopping cart (the agent-facing side).
window.catalogMixin = {
  data() {
    return {
      products: [],
      productsTotal: 0,
      pageSize: 60,
      pf: { search: '', category_id: '', in_stock: '', sort: 'name', dir: 'asc' },

      cart: [],
      showCart: false,
      orderForm: { customer_id: '', customer_name: '', customer_phone: '', notes: '' }
    };
  },

  computed: {
    cartTotal() { return this.cart.reduce((s, it) => s + this.lineTotal(it), 0); }
  },

  methods: {
    async loadProducts(more = false) {
      const offset = more ? this.products.length : 0;
      const { items, total } = await api('/api/products' + qs({ ...this.pf, limit: this.pageSize, offset }));
      this.products = more ? this.products.concat(items) : items;
      this.productsTotal = total;
    },

    addToCart(p) {
      const existing = this.cart.find(it => it.product_id === p.id);
      if (existing) { existing.qty = Math.min(existing.qty + 1, p.stock); }
      else {
        this.cart.push({
          product_id: p.id, name: p.name, sku: p.sku, qty: 1,
          unit_price: p.price, discount_pct: p.discount_pct || 0, max_stock: p.stock
        });
      }
      this.flash(`+ ${p.name}`);
    },

    async placeOrder() {
      this.busy = true;
      try {
        await api('/api/orders', { method: 'POST', body: { ...this.orderForm, items: this.cart } });
        this.cart = []; this.showCart = false;
        this.orderForm = { customer_id: '', customer_name: '', customer_phone: '', notes: '' };
        this.flash(this.t.orderPlaced);
        this.loadProducts();
        this.loadCustomersAll();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    }
  }
};
