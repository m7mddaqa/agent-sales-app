// Reports page.
window.reportsMixin = {
  data() {
    return {
      report: null,
      rf: { from: '', to: '', agent_id: '' }
    };
  },

  methods: {
    async loadReport() {
      this.report = await api('/api/reports/summary' + qs({ ...this.rf }));
    },

    barWidth(v) {
      const max = Math.max(...this.report.byDay.map(d => d.revenue), 1);
      return Math.max(2, (v / max) * 100) + '%';
    },

    exportOrdersReport() {
      location.href = '/api/excel/orders/export' + qs({ from: this.rf.from, to: this.rf.to, agent_id: this.rf.agent_id });
    }
  }
};
