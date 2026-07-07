// Customers page + the customer picker used by the cart.
window.customersMixin = {
  data() {
    return {
      customers: [],       // full list for the cart's customer picker
      customersList: [],   // filtered list for the customers page
      cf: { search: '', sort: 'name', dir: 'asc' },
      customerModal: null,
      customerForm: null
    };
  },

  methods: {
    async loadCustomers() {
      this.customersList = await api('/api/customers' + qs({ ...this.cf }));
    },

    async loadCustomersAll() {
      this.customers = await api('/api/customers');
    },

    sortCustomers(col) {
      if (this.cf.sort === col) this.cf.dir = this.cf.dir === 'asc' ? 'desc' : 'asc';
      else { this.cf.sort = col; this.cf.dir = col === 'name' ? 'asc' : 'desc'; }
      this.loadCustomers();
    },

    custArrow(col) {
      return this.cf.sort === col ? (this.cf.dir === 'asc' ? '↑' : '↓') : '';
    },

    async openCustomer(id) {
      this.customerModal = await api('/api/customers/' + id);
    },

    openCustomerForm(c) {
      this.customerForm = c
        ? { id: c.id, name: c.name, phone: c.phone, address: c.address, notes: c.notes }
        : { name: '', phone: '', address: '', notes: '' };
    },

    async saveCustomer() {
      this.busy = true;
      try {
        const f = this.customerForm;
        if (f.id) await api('/api/customers/' + f.id, { method: 'PUT', body: f });
        else await api('/api/customers', { method: 'POST', body: f });
        this.customerForm = null;
        this.flash(this.t.customerSaved);
        this.loadCustomers(); this.loadCustomersAll();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    },

    async deleteCustomerRec(c) {
      if (!confirm(this.t.confirmDeleteCustomer)) return;
      await api('/api/customers/' + c.id, { method: 'DELETE' });
      this.flash(this.t.deleted);
      this.loadCustomers(); this.loadCustomersAll();
    },

    exportCustomers() {
      location.href = '/api/excel/customers/export';
    }
  }
};
