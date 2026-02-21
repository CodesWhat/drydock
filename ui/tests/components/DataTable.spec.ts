import { mount } from '@vue/test-utils';
import DataTable from '@/components/DataTable.vue';

const columns = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'status', label: 'Status', sortable: true },
  { key: 'icon', label: '', icon: true },
];

const rows = [
  { id: '1', name: 'Alpha', status: 'running' },
  { id: '2', name: 'Beta', status: 'stopped' },
  { id: '3', name: 'Gamma', status: 'running' },
];

function factory(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  return mount(DataTable, {
    props: { columns, rows, rowKey: 'id', ...props },
    slots,
    global: { stubs: { AppIcon: { template: '<span class="app-icon-stub" />' } } },
  });
}

describe('DataTable', () => {
  describe('column headers', () => {
    it('renders a <th> for each column', () => {
      const w = factory();
      const ths = w.findAll('thead th');
      // 3 columns, no actions column by default
      expect(ths).toHaveLength(3);
    });

    it('displays column labels', () => {
      const w = factory();
      const ths = w.findAll('thead th');
      expect(ths[0].text()).toBe('Name');
      expect(ths[1].text()).toBe('Status');
    });

    it('hides label text for icon columns', () => {
      const w = factory();
      const iconTh = w.findAll('thead th')[2];
      expect(iconTh.text()).toBe('');
    });

    it('shows Actions header when showActions is true', () => {
      const w = factory({ showActions: true });
      const ths = w.findAll('thead th');
      expect(ths).toHaveLength(4);
      expect(ths[3].text()).toBe('Actions');
    });

    it('does not show Actions header when showActions is false', () => {
      const w = factory({ showActions: false });
      const ths = w.findAll('thead th');
      expect(ths).toHaveLength(3);
    });
  });

  describe('rows', () => {
    it('renders a <tr> per row in tbody', () => {
      const w = factory();
      expect(w.findAll('tbody tr')).toHaveLength(3);
    });

    it('renders cell data from row objects', () => {
      const w = factory();
      const firstRowCells = w.findAll('tbody tr')[0].findAll('td');
      expect(firstRowCells[0].text()).toBe('Alpha');
      expect(firstRowCells[1].text()).toBe('running');
    });

    it('uses striped backgrounds (alternating even/odd)', () => {
      const w = factory();
      const trs = w.findAll('tbody tr');
      const evenBg = trs[0].attributes('style');
      const oddBg = trs[1].attributes('style');
      expect(evenBg).toContain('dd-bg-card');
      expect(oddBg).toContain('dd-bg-inset');
    });
  });

  describe('row key', () => {
    it('supports string row key', () => {
      const w = factory({ rowKey: 'id' });
      expect(w.findAll('tbody tr')).toHaveLength(3);
    });

    it('supports function row key', () => {
      const w = factory({ rowKey: (r: any) => `key-${r.id}` });
      expect(w.findAll('tbody tr')).toHaveLength(3);
    });
  });

  describe('sorting', () => {
    it('emits update:sortKey and update:sortAsc=true when clicking a new column', async () => {
      const w = factory({ sortKey: 'name', sortAsc: true });
      const statusTh = w.findAll('thead th')[1]; // Status column
      await statusTh.trigger('click');
      expect(w.emitted('update:sortKey')?.[0]).toEqual(['status']);
      expect(w.emitted('update:sortAsc')?.[0]).toEqual([true]);
    });

    it('toggles sortAsc when clicking the already-sorted column', async () => {
      const w = factory({ sortKey: 'name', sortAsc: true });
      const nameTh = w.findAll('thead th')[0];
      await nameTh.trigger('click');
      expect(w.emitted('update:sortAsc')?.[0]).toEqual([false]);
      expect(w.emitted('update:sortKey')).toBeUndefined();
    });

    it('shows ascending indicator when sortAsc is true', () => {
      const w = factory({ sortKey: 'name', sortAsc: true });
      const nameTh = w.findAll('thead th')[0];
      expect(nameTh.text()).toContain('\u25B2');
    });

    it('shows descending indicator when sortAsc is false', () => {
      const w = factory({ sortKey: 'name', sortAsc: false });
      const nameTh = w.findAll('thead th')[0];
      expect(nameTh.text()).toContain('\u25BC');
    });

    it('does not emit sort events when clicking an icon column', async () => {
      const w = factory({ sortKey: 'name', sortAsc: true });
      const iconTh = w.findAll('thead th')[2];
      await iconTh.trigger('click');
      expect(w.emitted('update:sortKey')).toBeUndefined();
      expect(w.emitted('update:sortAsc')).toBeUndefined();
    });

    it('does not emit sort events when clicking a non-sortable column', async () => {
      const nonSortCols = [{ key: 'name', label: 'Name', sortable: false }];
      const w = factory({ columns: nonSortCols });
      await w.findAll('thead th')[0].trigger('click');
      expect(w.emitted('update:sortKey')).toBeUndefined();
    });
  });

  describe('selection', () => {
    it('applies ring class to the selected row', () => {
      const w = factory({ selectedKey: '2' });
      const trs = w.findAll('tbody tr');
      expect(trs[1].classes()).toContain('ring-1');
      expect(trs[1].classes()).toContain('ring-drydock-secondary');
    });

    it('does not apply ring class to unselected rows', () => {
      const w = factory({ selectedKey: '2' });
      expect(w.findAll('tbody tr')[0].classes()).not.toContain('ring-1');
    });

    it('applies elevated bg to the selected row', () => {
      const w = factory({ selectedKey: '1' });
      const style = w.findAll('tbody tr')[0].attributes('style');
      expect(style).toContain('dd-bg-elevated');
    });
  });

  describe('row click', () => {
    it('emits row-click with the row data', async () => {
      const w = factory();
      await w.findAll('tbody tr')[1].trigger('click');
      expect(w.emitted('row-click')?.[0]).toEqual([rows[1]]);
    });
  });

  describe('actions column', () => {
    it('renders actions td per row when showActions is true', () => {
      const w = factory({ showActions: true }, { actions: '<span class="action-btn">Act</span>' });
      const firstRow = w.findAll('tbody tr')[0];
      const tds = firstRow.findAll('td');
      // columns.length + 1 for actions
      expect(tds).toHaveLength(4);
    });

    it('does not render actions td when showActions is falsy', () => {
      const w = factory();
      const tds = w.findAll('tbody tr')[0].findAll('td');
      expect(tds).toHaveLength(3);
    });
  });

  describe('empty state', () => {
    it('renders empty slot when rows is empty', () => {
      const w = factory({ rows: [] }, { empty: '<div class="empty-msg">No data</div>' });
      expect(w.find('.empty-msg').exists()).toBe(true);
      expect(w.find('.empty-msg').text()).toBe('No data');
    });

    it('does not render empty slot when rows exist', () => {
      const w = factory({}, { empty: '<div class="empty-msg">No data</div>' });
      expect(w.find('.empty-msg').exists()).toBe(false);
    });
  });

  describe('cell slots', () => {
    it('renders custom cell slot content', () => {
      const w = factory({}, { 'cell-name': ({ row }: any) => `Custom: ${row.name}` });
      const firstCell = w.findAll('tbody tr')[0].findAll('td')[0];
      expect(firstCell.text()).toContain('Custom: Alpha');
    });
  });
});
