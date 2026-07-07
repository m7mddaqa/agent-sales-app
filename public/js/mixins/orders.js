// Orders list, order details and editing.
window.ordersMixin = {
  data() {
    return {
      orders: [],
      of: { search: '', status: '', agent_id: '', from: '', to: '', sort: 'created', dir: 'desc' },
      orderModal: null,
      orderEdit: false,
      editItems: [],
      itemSearch: '',
      itemResults: []
    };
  },

  methods: {
    async loadOrders() { this.orders = await api('/api/orders' + qs({ ...this.of })); },

    sortOrders(col) {
      if (this.of.sort === col) this.of.dir = this.of.dir === 'asc' ? 'desc' : 'asc';
      else { this.of.sort = col; this.of.dir = col === 'created' ? 'desc' : 'asc'; }
      this.loadOrders();
    },

    sortArrow(col) {
      return this.of.sort === col ? (this.of.dir === 'asc' ? '↑' : '↓') : '';
    },

    async openOrder(id) {
      this.orderEdit = false;
      this.orderModal = await api('/api/orders/' + id);
    },

    canEditOrder(o) {
      if (o.status === 'cancelled') return false;
      if (this.isAdmin) return true;
      return o.status === 'pending';
    },

    canCancelOrder(o) {
      return o.status !== 'cancelled' && (this.isAdmin || o.status === 'pending');
    },

    async startOrderEdit() {
      this.itemSearch = ''; this.itemResults = [];
      this.editItems = this.orderModal.items.map(it => ({
        product_id: it.product_id, name: it.product_name, qty: it.qty,
        unit_price: it.unit_price, discount_pct: it.discount_pct
      }));
      this.orderEdit = true;
    },

    async searchItems() {
      const q = this.itemSearch.trim();
      if (!q) { this.itemResults = []; return; }
      const { items } = await api('/api/products' + qs({ search: q, in_stock: '1', limit: 8 }));
      this.itemResults = items;
    },

    addEditItem(p) {
      const existing = this.editItems.find(it => it.product_id === p.id);
      if (existing) existing.qty++;
      else this.editItems.push({ product_id: p.id, name: p.name, qty: 1, unit_price: p.price, discount_pct: p.discount_pct || 0 });
      this.itemSearch = ''; this.itemResults = [];
    },

    async saveOrderEdit() {
      this.busy = true;
      try {
        this.orderModal = await api('/api/orders/' + this.orderModal.id, {
          method: 'PUT',
          body: {
            items: this.editItems,
            customer_name: this.orderModal.customer_name,
            customer_phone: this.orderModal.customer_phone,
            notes: this.orderModal.notes
          }
        });
        this.orderEdit = false;
        this.flash(this.t.orderPlaced);
        this.loadOrders(); this.loadProducts();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    },

    async setOrderStatus(order, status) {
      if (status === 'cancelled' && !confirm(this.t.confirmCancelOrder)) {
        this.openOrder(order.id); // restore the select to the real status
        return;
      }
      try {
        this.orderModal = await api('/api/orders/' + order.id, { method: 'PUT', body: { status } });
        this.loadOrders();
        this.loadProducts(); // cancel/reopen moves stock
      } catch (e) { this.flash(this.errMsg(e), 'bad'); this.openOrder(order.id); }
    },

    async cancelOrder(order) {
      if (!confirm(this.t.confirmCancelOrder)) return;
      try {
        this.orderModal = await api('/api/orders/' + order.id, { method: 'PUT', body: { status: 'cancelled' } });
        this.loadOrders(); this.loadProducts();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
    },

    async deleteOrder(order) {
      if (!confirm(this.t.confirmDeleteOrder)) return;
      try {
        await api('/api/orders/' + order.id, { method: 'DELETE' });
        this.orderModal = null;
        this.flash(this.t.deleted);
        this.loadOrders();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
    },

    exportOrders() {
      location.href = '/api/excel/orders/export' + qs({
        from: this.of.from, to: this.of.to, status: this.of.status, agent_id: this.of.agent_id
      });
    }
  }
};
