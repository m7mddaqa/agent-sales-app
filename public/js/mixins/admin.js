// Admin panel: products, categories, users, Excel import and the history/undo tab.
window.adminMixin = {
  data() {
    return {
      adminTab: 'products',
      adminProducts: [],
      adminTotal: 0,
      users: [],
      actionLog: [],
      productForm: null,
      userForm: null,
      newCatName: '',
      newSubName: '',
      addingSubFor: null,
      importMsg: ''
    };
  },

  methods: {
    // ----- products -----
    async loadAdminProducts(more = false) {
      const offset = more ? this.adminProducts.length : 0;
      const { items, total } = await api('/api/products' + qs({ ...this.pf, active: 'all', limit: this.pageSize, offset }));
      this.adminProducts = more ? this.adminProducts.concat(items) : items;
      this.adminTotal = total;
    },

    openProductForm(p) {
      this.productForm = p
        ? { ...p }
        : { sku: '', name: '', barcode: '', description: '', category_id: null, price: 0, cost: 0, stock: 0, discount_pct: 0, active: 1, image: '' };
    },

    async saveProduct() {
      this.busy = true;
      try {
        const f = this.productForm;
        const saved = f.id
          ? await api('/api/products/' + f.id, { method: 'PUT', body: f })
          : await api('/api/products', { method: 'POST', body: f });
        this.productForm = { ...this.productForm, ...saved };
        this.flash(this.t.productSaved);
        this.loadAdminProducts(); this.loadCategories();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    },

    async uploadImage(ev) {
      const file = ev.target.files[0];
      if (!file || !this.productForm.id) return;
      const fd = new FormData();
      fd.append('image', file);
      try {
        const { image } = await api(`/api/products/${this.productForm.id}/image`, { method: 'POST', body: fd });
        this.productForm.image = image;
        this.flash(this.t.productSaved);
        this.loadAdminProducts();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      ev.target.value = '';
    },

    async deleteProduct(p) {
      if (!confirm(`${this.t.delete} "${p.name}"?`)) return;
      const res = await api('/api/products/' + p.id, { method: 'DELETE' });
      this.flash(res.deactivated ? this.t.deactivatedInstead : this.t.deleted);
      this.loadAdminProducts();
    },

    // ----- categories -----
    async addCategory() {
      try {
        await api('/api/categories', { method: 'POST', body: { name: this.newCatName } });
        this.newCatName = '';
        this.loadCategories();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
    },

    async addSubcategory(parent) {
      if (!this.newSubName.trim()) return;
      try {
        await api('/api/categories', { method: 'POST', body: { name: this.newSubName, parent_id: parent.id } });
        this.newSubName = '';
        this.addingSubFor = null;
        this.loadCategories();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
    },

    async renameCategory(c) {
      try { await api('/api/categories/' + c.id, { method: 'PUT', body: { name: c.name } }); this.flash(this.t.productSaved); }
      catch (e) { this.flash(this.errMsg(e), 'bad'); this.loadCategories(); }
    },

    async deleteCategory(c) {
      if (!confirm(this.t.confirmDeleteCategory)) return;
      await api('/api/categories/' + c.id, { method: 'DELETE' });
      this.loadCategories();
      this.loadProducts();
    },

    // ----- users -----
    async loadUsers() { this.users = await api('/api/users'); },

    openUserForm(u) {
      this.userForm = u
        ? { ...u, password: '' }
        : { username: '', password: '', name: '', phone: '', role: 'agent', active: 1 };
    },

    async saveUser() {
      this.busy = true;
      try {
        const f = this.userForm;
        if (f.id) await api('/api/users/' + f.id, { method: 'PUT', body: f });
        else await api('/api/users', { method: 'POST', body: f });
        this.userForm = null;
        this.flash(this.t.userSaved);
        this.loadUsers();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    },

    // ----- excel import -----
    async importProducts(ev) {
      const file = ev.target.files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append('file', file);
      this.importMsg = this.t.loading;
      try {
        const r = await api('/api/excel/products/import', { method: 'POST', body: fd });
        this.importMsg = `${this.t.importResult}: ${r.created} ${this.t.created}, ${r.updated} ${this.t.updated}` +
          (r.errors.length ? ` (${r.errors.length} ${this.t.importErrors})` : '');
        this.loadAdminProducts(); this.loadCategories();
      } catch (e) {
        this.importMsg = '';
        this.flash(this.errMsg(e), 'bad');
      }
      ev.target.value = '';
    },

    // ----- history & undo -----
    async loadActions() {
      try { this.actionLog = await api('/api/actions'); } catch (e) { /* ignore */ }
    },

    actionLabel(a) {
      return this.t['act_' + a.type] || a.type;
    },

    async undoAction(a) {
      if (!confirm(this.t.confirmUndo)) return;
      this.busy = true;
      try {
        await api('/api/actions/' + a.id + '/undo', { method: 'POST' });
        this.flash(this.t.undoDone);
        this.loadActions(); this.loadAdminProducts(); this.loadCategories();
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    }
  }
};
