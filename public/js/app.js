// App root: auth, language, navigation and shared state.
// Feature-specific state and methods live in the mixins under js/mixins/.
const { createApp } = Vue;

createApp({
  mixins: [catalogMixin, ordersMixin, customersMixin, reportsMixin, adminMixin],

  data() {
    const lang = localStorage.getItem('lang') || 'en';
    return {
      lang,
      langs: Object.fromEntries(Object.entries(I18N).map(([k, v]) => [k, v.langName])),
      user: null,
      view: 'products',
      busy: false,
      toast: null,
      statuses: ['pending', 'approved', 'delivered', 'cancelled'],

      loginForm: { username: '', password: '' },
      loginError: false,

      categories: [],

      showPwd: false,
      pwdForm: { current: '', next: '' }
    };
  },

  computed: {
    t() { return I18N[this.lang]; },
    isAdmin() { return this.user && this.user.role === 'admin'; },
    agents() { return this.users.filter(u => u.role === 'agent' || u.role === 'admin'); },
    categoryTree() {
      return this.categories.filter(c => !c.parent_id).map(c => ({
        ...c, children: this.categories.filter(s => s.parent_id === c.id)
      }));
    },
    categoryOptions() {
      const out = [];
      for (const c of this.categoryTree) {
        out.push({ id: c.id, label: c.name, depth: 0 });
        for (const s of c.children) out.push({ id: s.id, label: s.name, depth: 1 });
      }
      return out;
    }
  },

  created() {
    this.debouncedProducts = debounce(() => this.loadProducts(), 300);
    this.debouncedOrders = debounce(() => this.loadOrders(), 300);
    this.debouncedAdminProducts = debounce(() => this.loadAdminProducts(), 300);
    this.debouncedCustomers = debounce(() => this.loadCustomers(), 300);
    this.debouncedItemSearch = debounce(() => this.searchItems(), 300);
    this.init();
  },

  methods: {
    async init() {
      try {
        const { user } = await api('/api/auth/me');
        if (user) { this.user = user; await this.afterLogin(); }
      } catch (e) { /* not logged in */ }
    },

    setLang(code) {
      this.lang = code;
      localStorage.setItem('lang', code);
      document.documentElement.lang = code;
    },

    flash(msg, kind = 'ok') {
      this.toast = { msg, kind };
      clearTimeout(this._toastT);
      this._toastT = setTimeout(() => (this.toast = null), 3500);
    },

    errMsg(e) {
      const map = {
        bad_credentials: this.t.badCredentials, duplicate_sku: this.t.duplicateSku,
        duplicate_username: this.t.duplicateUsername, duplicate_name: this.t.duplicateName,
        missing_fields: this.t.missingFields, sku_and_name_required: this.t.missingFields,
        password_too_short: this.t.passwordTooShort, wrong_password: this.t.wrongPassword,
        only_pending_editable: this.t.onlyPendingEditable
      };
      if (e.data && e.data.error === 'insufficient_stock') {
        return `${this.t.insufficientStock} "${e.data.product}"`;
      }
      return map[e.data && e.data.error] || this.t.error;
    },

    money(v) {
      return '₪' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    fmtDate(s) {
      return new Date(s.replace(' ', 'T') + 'Z').toLocaleString(this.lang === 'en' ? undefined : this.lang, {
        year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
      });
    },

    lineTotal(it) {
      return (it.qty || 0) * (it.unit_price || 0) * (1 - (it.discount_pct || 0) / 100);
    },

    // ---------- auth ----------
    async doLogin() {
      this.busy = true; this.loginError = false;
      try {
        const { user } = await api('/api/auth/login', { method: 'POST', body: this.loginForm });
        this.user = user;
        this.loginForm = { username: '', password: '' };
        await this.afterLogin();
      } catch (e) {
        this.loginError = true;
      } finally { this.busy = false; }
    },

    async afterLogin() {
      await Promise.all([this.loadCategories(), this.loadProducts(), this.loadCustomersAll()]);
      if (this.isAdmin) this.loadUsers();
    },

    async doLogout() {
      await api('/api/auth/logout', { method: 'POST' });
      this.user = null; this.view = 'products'; this.cart = []; this.orders = []; this.report = null;
    },

    async changePassword() {
      this.busy = true;
      try {
        await api('/api/auth/password', { method: 'POST', body: this.pwdForm });
        this.showPwd = false; this.pwdForm = { current: '', next: '' };
        this.flash(this.t.passwordChanged);
      } catch (e) { this.flash(this.errMsg(e), 'bad'); }
      finally { this.busy = false; }
    },

    go(view) {
      this.view = view;
      if (view === 'products') this.loadProducts();
      if (view === 'orders') this.loadOrders();
      if (view === 'customers') this.loadCustomers();
      if (view === 'reports') this.loadReport();
      if (view === 'admin') { this.loadAdminProducts(); this.loadUsers(); }
    },

    async loadCategories() { this.categories = await api('/api/categories'); }
  }
}).mount('#app');
