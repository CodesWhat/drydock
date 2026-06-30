import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
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

function dispatchPointer(target: EventTarget, type: string, init: Record<string, unknown> = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries(init)) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  target.dispatchEvent(event);
}

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

    it('right-aligns Actions header text to match action buttons', () => {
      const w = factory({ showActions: true });
      const actionsHeader = w.findAll('thead th')[3];
      expect(actionsHeader.classes()).toContain('text-right');
    });

    it('does not show Actions header when showActions is false', () => {
      const w = factory({ showActions: false });
      const ths = w.findAll('thead th');
      expect(ths).toHaveLength(3);
    });

    it('defaults actions column width to 80px', () => {
      const w = factory({ showActions: true });
      const actionsCol = w.find('colgroup col[data-col-key="__actions__"]');
      expect(actionsCol.attributes('style')).toContain('width: 80px');
    });

    it('applies actionsWidth override to the actions colgroup entry', () => {
      const w = factory({ showActions: true, actionsWidth: '180px' });
      const actionsCol = w.find('colgroup col[data-col-key="__actions__"]');
      expect(actionsCol.attributes('style')).toContain('width: 180px');
    });

    it('uses fixed table layout when fixedLayout is enabled', () => {
      const w = factory({ fixedLayout: true });
      expect(w.find('table').attributes('style')).toContain('table-layout: fixed');
    });

    it('keeps legacy width compatibility through colgroup while callers migrate', () => {
      const cols = [
        { key: 'name', label: 'Name', width: '320px' },
        { key: 'status', label: 'Status', width: '90px' },
      ];
      const w = mount(DataTable, {
        props: { columns: cols, rows: [], rowKey: 'id', fixedLayout: true },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });
      const colEls = w.findAll('colgroup col');
      expect(colEls[0].attributes('style')).toContain('width: 320px');
      expect(colEls[1].attributes('style')).toContain('width: 90px');
      expect(w.findAll('thead th')[0].attributes('style') ?? '').not.toContain('width:');
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

    it('vertically centers row cells so multi-line content stays aligned with icons + actions', () => {
      const w = factory();
      const firstRowCells = w.findAll('tbody tr')[0].findAll('td');

      expect(firstRowCells[0].classes()).toContain('align-middle');
      expect(firstRowCells[0].classes()).not.toContain('align-top');
      expect(firstRowCells[2].classes()).toContain('align-middle');
      expect(firstRowCells[2].classes()).not.toContain('align-top');
    });

    it('uses striped backgrounds (alternating even/odd)', () => {
      const w = factory();
      const trs = w.findAll('tbody tr');
      const evenBg = trs[0].attributes('style');
      const oddBg = trs[1].attributes('style');
      expect(evenBg).toContain('dd-bg-card');
      expect(oddBg).toContain('dd-bg-inset');
    });

    it('renders a full-width row slot when a row is marked full width', () => {
      const mixedRows = [
        { id: 'group-a', name: 'Group A', status: 'meta', kind: 'group' },
        ...rows,
      ];
      const w = factory(
        {
          rows: mixedRows,
          fullWidthRow: (row: { kind?: string }) => row.kind === 'group',
        },
        {
          'full-row': ({ row }: any) => `<div class="full-row">Header: ${row.name}</div>`,
        },
      );

      const firstRow = w.findAll('tbody tr')[0];
      const cells = firstRow.findAll('td');

      expect(cells).toHaveLength(1);
      expect(cells[0].attributes('colspan')).toBe('3');
      expect(firstRow.text()).toContain('Header: Group A');
    });

    it('provides a stable first-cell host for row overlay badges', () => {
      const w = mount(DataTable, {
        props: {
          columns: [
            { key: 'icon', label: '', icon: true },
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' },
          ],
          rowClass: (row: { id: string }) => (row.id === '2' ? 'dd-row-updating' : ''),
          rowKey: 'id',
          rows,
        },
        slots: {
          'cell-icon':
            '<div class="dd-row-overlay absolute inset-0"><span>Pulling...</span></div><span class="icon">icon</span>',
        },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });

      const updatingRow = w.findAll('tbody tr')[1];
      const overlayHost = updatingRow.find('td.dd-data-table-row-overlay-host');

      expect(overlayHost.exists()).toBe(true);
      expect(overlayHost.find('.dd-row-overlay').exists()).toBe(true);
      expect(w.find('table').attributes('style')).toContain('--dd-data-table-row-overlay-width');
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

  describe('accessibility', () => {
    it('sets aria-sort on sortable headers', () => {
      const w = factory({ sortKey: 'name', sortAsc: true });
      const ths = w.findAll('thead th');
      expect(ths[0].attributes('aria-sort')).toBe('ascending');
      expect(ths[1].attributes('aria-sort')).toBe('none');
      expect(ths[2].attributes('aria-sort')).toBeUndefined();
    });

    it('sets aria-sort to descending when the active sort is descending', () => {
      const w = factory({ sortKey: 'status', sortAsc: false });
      const ths = w.findAll('thead th');
      expect(ths[0].attributes('aria-sort')).toBe('none');
      expect(ths[1].attributes('aria-sort')).toBe('descending');
    });
  });

  describe('selection', () => {
    it('applies selected row class to the selected row', () => {
      const w = factory({ selectedKey: '2' });
      const trs = w.findAll('tbody tr');
      expect(trs[1].classes()).toContain('dd-data-table-row-selected');
    });

    it('does not apply selected row class to unselected rows', () => {
      const w = factory({ selectedKey: '2' });
      expect(w.findAll('tbody tr')[0].classes()).not.toContain('dd-data-table-row-selected');
    });

    it('applies elevated bg to the selected row', () => {
      const w = factory({ selectedKey: '1' });
      const style = w.findAll('tbody tr')[0].attributes('style');
      expect(style).toContain('dd-bg-elevated');
    });

    it('extends selected row styling through the sticky actions cell', () => {
      const w = factory(
        { selectedKey: '2', showActions: true },
        { actions: '<span class="action-btn">Act</span>' },
      );
      const selectedRow = w.findAll('tbody tr')[1];
      const cells = selectedRow.findAll('td');
      const actionsCell = cells[cells.length - 1];

      expect(selectedRow.classes()).toContain('dd-data-table-row-selected');
      expect(selectedRow.attributes('style')).toContain('--dd-data-table-row-bg');
      expect(actionsCell.classes()).toEqual(
        expect.arrayContaining([
          'dd-data-table-cell',
          'dd-data-table-actions-cell',
          'sticky',
          'right-0',
        ]),
      );
      expect(actionsCell.attributes('style') ?? '').not.toContain('background-color');
    });
  });

  describe('row click', () => {
    it('emits row-click with the row data', async () => {
      const w = factory();
      await w.findAll('tbody tr')[1].trigger('click');
      expect(w.emitted('row-click')?.[0]).toEqual([rows[1]]);
    });
  });

  describe('row keyboard navigation', () => {
    it('sets tabindex on rows', () => {
      const w = factory();
      const row = w.findAll('tbody tr')[0];
      expect(row.attributes('tabindex')).toBe('0');
    });

    it('emits row-click on Enter keydown', async () => {
      const w = factory();
      await w.findAll('tbody tr')[0].trigger('keydown', { key: 'Enter' });
      expect(w.emitted('row-click')?.[0]).toEqual([rows[0]]);
    });

    it('emits row-click on Space keydown', async () => {
      const w = factory();
      await w.findAll('tbody tr')[2].trigger('keydown', { key: ' ' });
      expect(w.emitted('row-click')?.[0]).toEqual([rows[2]]);
    });

    it('does not emit row-click on other keys', async () => {
      const w = factory();
      await w.findAll('tbody tr')[0].trigger('keydown', { key: 'Tab' });
      expect(w.emitted('row-click')).toBeUndefined();
    });

    it('skips tabindex and row-click for non-interactive rows', async () => {
      const mixedRows = [
        { id: 'group-a', name: 'Group A', status: 'meta', kind: 'group' },
        ...rows,
      ];
      const w = factory({
        rows: mixedRows,
        rowInteractive: (row: { kind?: string }) => row.kind !== 'group',
      });

      const firstRow = w.findAll('tbody tr')[0];
      expect(firstRow.attributes('tabindex')).toBeUndefined();

      await firstRow.trigger('click');
      await firstRow.trigger('keydown', { key: 'Enter' });

      expect(w.emitted('row-click')).toBeUndefined();
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

    it('does not put a data-column resize handle inside the managed actions header', () => {
      const resizeColumns = [
        { key: 'host', label: 'Host', sortable: true },
        { key: 'registry', label: 'Registry', sortable: true },
      ];
      const w = factory({ columns: resizeColumns, showActions: true });
      const actionsHeader = w.findAll('thead th')[2];
      expect(actionsHeader.text()).toContain('Actions');
      expect(actionsHeader.find('[role="separator"]').exists()).toBe(false);
    });

    it('keeps the shared actions column sticky to the right edge', () => {
      const w = factory({ showActions: true }, { actions: '<span class="action-btn">Act</span>' });
      const actionsHeader = w.findAll('thead th')[3];
      const actionsCell = w.findAll('tbody tr')[0].findAll('td')[3];

      expect(actionsHeader.classes()).toEqual(expect.arrayContaining(['sticky', 'right-0']));
      expect(actionsCell.classes()).toEqual(expect.arrayContaining(['sticky', 'right-0']));
      expect(actionsCell.classes()).toContain('dd-data-table-actions-cell');
      expect(actionsCell.attributes('style') ?? '').not.toContain('background-color');
    });
  });

  describe('managed column sizing', () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it('normalizes numeric and legacy sizing into a stable colgroup', () => {
      const w = mount(DataTable, {
        props: {
          columns: [
            { key: 'name', label: 'Name', size: 280, minSize: 180, flex: 1 },
            { key: 'status', label: 'Status', width: '96px' },
            { key: 'notes', label: 'Notes', width: '99%' },
          ],
          rows,
          rowKey: 'id',
          showActions: true,
          actionsWidth: '144px',
        },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });

      const cols = w.findAll('colgroup col');
      expect(cols).toHaveLength(4);
      expect(cols[0].attributes('style')).toContain('width: 280px');
      expect(cols[1].attributes('style')).toContain('width: 96px');
      expect(cols[2].attributes('style')).toContain('width: 160px');
      expect(cols[3].attributes('data-col-key')).toBe('__actions__');
      expect(cols[3].attributes('style')).toContain('width: 144px');
      expect(w.findAll('thead th')[0].attributes('style') ?? '').not.toContain('width:');
      expect(w.find('table').attributes('style')).toContain('table-layout: fixed');
    });

    it('resizes with pointer events within min and max caps', async () => {
      const w = mount(DataTable, {
        props: {
          columns: [
            { key: 'name', label: 'Name', size: 180, minSize: 120, maxSize: 240 },
            { key: 'status', label: 'Status', size: 100 },
          ],
          rows,
          rowKey: 'id',
        },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });

      const resizeHandle = w.findAll('[role="separator"]')[0];
      expect(resizeHandle.exists()).toBe(true);
      dispatchPointer(resizeHandle.element, 'pointerdown', {
        clientX: 100,
        pointerId: 1,
        button: 0,
      });
      expect(document.body.classList.contains('dd-col-resizing')).toBe(true);

      dispatchPointer(document, 'pointermove', { clientX: 300, pointerId: 1 });
      await nextTick();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 240px',
      );

      dispatchPointer(document, 'pointermove', { clientX: -100, pointerId: 1 });
      await nextTick();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 120px',
      );

      dispatchPointer(document, 'pointerup', { pointerId: 1 });
      await nextTick();
      expect(document.body.classList.contains('dd-col-resizing')).toBe(false);
    });

    it('supports accessible keyboard resizing and reset on separators', async () => {
      const w = mount(DataTable, {
        props: {
          columns: [
            { key: 'name', label: 'Name', size: 180, minSize: 120, maxSize: 260 },
            { key: 'status', label: 'Status', size: 100 },
          ],
          rows,
          rowKey: 'id',
        },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });

      const resizeHandle = w.findAll('[role="separator"]')[0];
      expect(resizeHandle.attributes('aria-orientation')).toBe('vertical');
      expect(resizeHandle.attributes('aria-valuemin')).toBe('120');
      expect(resizeHandle.attributes('aria-valuemax')).toBe('260');
      expect(resizeHandle.attributes('aria-valuenow')).toBe('180');
      expect(resizeHandle.attributes('tabindex')).toBe('0');

      await resizeHandle.trigger('keydown', { key: 'ArrowRight' });
      await nextTick();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 190px',
      );

      await resizeHandle.trigger('keydown', { key: 'ArrowLeft', shiftKey: true });
      await nextTick();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 140px',
      );

      await resizeHandle.trigger('keydown', { key: 'Escape' });
      await nextTick();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 180px',
      );
    });

    it('autosizes on double-click using visible rendered content and persists by storageKey', async () => {
      const w = mount(DataTable, {
        props: {
          storageKey: 'data-table-spec',
          columns: [
            { key: 'name', label: 'Name', size: 140, minSize: 80, maxSize: 320 },
            { key: 'status', label: 'Status', size: 100 },
          ],
          rows,
          rowKey: 'id',
        },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });

      const header = w.find('thead th[data-col-key="name"]').element as HTMLElement;
      Object.defineProperty(header, 'scrollWidth', { configurable: true, value: 260 });
      const firstCell = w.find('tbody td[data-col-key="name"]').element as HTMLElement;
      Object.defineProperty(firstCell, 'scrollWidth', { configurable: true, value: 300 });

      const resizeHandle = w.findAll('[role="separator"]')[0];
      await resizeHandle.trigger('dblclick');
      await nextTick();

      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 320px',
      );

      const { flushPreferences } = await import('@/preferences/store');
      flushPreferences();
      const stored = JSON.parse(localStorage.getItem('dd-preferences') ?? '{}');
      expect(stored.tables.columnWidths['data-table-spec'].name).toBe(320);
    });

    it('does not resize the previous data column from the sticky actions column', () => {
      const w = mount(DataTable, {
        props: {
          columns: [
            { key: 'name', label: 'Name', size: 220 },
            { key: 'status', label: 'Status', size: 100 },
          ],
          rows,
          rowKey: 'id',
          showActions: true,
          actionsWidth: '180px',
        },
        slots: { actions: '<button>Act</button>' },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });

      const actionsHeader = w.find('thead th[data-col-key="__actions__"]');
      expect(actionsHeader.exists()).toBe(true);
      expect(actionsHeader.classes()).toEqual(expect.arrayContaining(['sticky', 'right-0']));
      expect(actionsHeader.find('[role="separator"]').exists()).toBe(false);
      expect(w.find('colgroup col[data-col-key="status"]').attributes('style')).toContain(
        'width: 100px',
      );
      expect(w.find('colgroup col[data-col-key="__actions__"]').attributes('style')).toContain(
        'width: 180px',
      );
    });
  });

  describe('column resize performance', () => {
    it('renders resize movement through colgroup instead of header width attributes', async () => {
      const resizeColumns = [
        { key: 'name', label: 'Name', sortable: true, size: 120, minSize: 80, maxSize: 220 },
        { key: 'status', label: 'Status', sortable: true, size: 100 },
      ];
      const w = mount(DataTable, {
        props: { columns: resizeColumns, rows, rowKey: 'id' },
        global: {
          stubs: { AppIcon: { template: '<span class="app-icon-stub" />' } },
        },
      });

      const firstHeader = w.findAll('thead th')[0];
      const resizeHandle = firstHeader.find('[role="separator"]');
      expect(resizeHandle.exists()).toBe(true);

      dispatchPointer(resizeHandle.element, 'pointerdown', {
        clientX: 100,
        pointerId: 1,
        button: 0,
      });
      await nextTick();

      dispatchPointer(document, 'pointermove', { clientX: 110, pointerId: 1 });
      await nextTick();
      dispatchPointer(document, 'pointermove', { clientX: 130, pointerId: 1 });
      await nextTick();
      dispatchPointer(document, 'pointermove', { clientX: 160, pointerId: 1 });
      await nextTick();

      expect(firstHeader.attributes('width')).toBeUndefined();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 180px',
      );

      dispatchPointer(document, 'pointerup', { pointerId: 1 });
      await nextTick();
    });

    it('toggles body resize class during drag without relying on inline body styles', async () => {
      const resizeColumns = [
        { key: 'name', label: 'Name', sortable: true, size: 120, minSize: 80, maxSize: 220 },
        { key: 'status', label: 'Status', sortable: true, size: 100 },
      ];
      const w = mount(DataTable, {
        props: { columns: resizeColumns, rows, rowKey: 'id' },
        global: {
          stubs: { AppIcon: { template: '<span class="app-icon-stub" />' } },
        },
      });

      const firstHeader = w.findAll('thead th')[0];
      const resizeHandle = firstHeader.find('[role="separator"]');
      expect(resizeHandle.exists()).toBe(true);

      dispatchPointer(resizeHandle.element, 'pointerdown', {
        clientX: 100,
        pointerId: 1,
        button: 0,
      });
      expect(document.body.classList.contains('dd-col-resizing')).toBe(true);

      dispatchPointer(document, 'pointermove', { clientX: 140, pointerId: 1 });
      await nextTick();
      expect(firstHeader.attributes('width')).toBeUndefined();
      expect(w.find('colgroup col[data-col-key="name"]').attributes('style')).toContain(
        'width: 160px',
      );

      dispatchPointer(document, 'pointerup', { pointerId: 1 });
      await nextTick();
      expect(document.body.classList.contains('dd-col-resizing')).toBe(false);
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

  describe('virtual scrolling', () => {
    function makeRows(count: number) {
      return Array.from({ length: count }, (_, i) => ({
        id: `${i + 1}`,
        name: `Container ${i + 1}`,
        status: i % 2 === 0 ? 'running' : 'stopped',
      }));
    }

    it('renders only a visible window when virtual scrolling is enabled', () => {
      const manyRows = makeRows(200);
      const w = factory({
        rows: manyRows,
        virtualScroll: true,
        virtualRowHeight: 40,
        virtualMaxHeight: '120px',
      });

      const renderedRows = w.findAll('tbody tr').filter((tr) => !tr.attributes('aria-hidden'));
      expect(renderedRows.length).toBeLessThan(manyRows.length);
      expect(renderedRows.length).toBeGreaterThan(0);
    });

    it('updates the rendered window after scrolling', async () => {
      const manyRows = makeRows(200);
      const w = factory({
        rows: manyRows,
        virtualScroll: true,
        virtualRowHeight: 40,
        virtualMaxHeight: '120px',
      });

      const scrollViewport = w.find('[data-test="data-table-scroll"]');
      expect(scrollViewport.exists()).toBe(true);

      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('Container 1'))).toBe(true);

      (scrollViewport.element as HTMLElement).scrollTop = 1200;
      scrollViewport.trigger('scroll');
      await nextTick();

      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('Container 1'))).toBe(false);
      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('Container 25'))).toBe(true);
    });

    it('honors a caller-provided rowHeight estimator for heterogeneous rows', async () => {
      // Two tall anchor rows (200px each) bracket many thin rows (20px each). The bottom
      // spacer should reflect the real prefix-sum total, not rows.length * fallback height.
      const rows = [
        { id: 'tall-top', name: 'TallTop', status: '', kind: 'tall' },
        ...Array.from({ length: 100 }, (_, i) => ({
          id: `thin-${i}`,
          name: `Thin ${i}`,
          status: '',
          kind: 'thin',
        })),
        { id: 'tall-bottom', name: 'TallBottom', status: '', kind: 'tall' },
      ];
      const rowHeight = (row: Record<string, unknown>) => (row.kind === 'tall' ? 200 : 20);

      const w = factory({
        rows,
        virtualScroll: true,
        virtualRowHeight: 20,
        virtualMaxHeight: '100px',
        rowHeight,
      });

      const scrollViewport = w.find('[data-test="data-table-scroll"]');
      expect(scrollViewport.exists()).toBe(true);

      // Initial: only the tall top + first few thin rows visible.
      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('TallTop'))).toBe(true);
      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('TallBottom'))).toBe(false);

      // Scroll far enough to reach the bottom anchor (200 + 100*20 = 2200).
      (scrollViewport.element as HTMLElement).scrollTop = 2400;
      scrollViewport.trigger('scroll');
      await nextTick();

      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('TallBottom'))).toBe(true);
      expect(w.findAll('tbody tr').some((tr) => tr.text().includes('TallTop'))).toBe(false);
    });

    it('falls back to virtualRowHeight when the rowHeight estimator returns an invalid value', () => {
      const rows = [
        { id: '1', name: 'A', status: '' },
        { id: '2', name: 'B', status: '' },
      ];
      const rowHeight = () => Number.NaN;

      const w = factory({
        rows,
        virtualScroll: true,
        virtualRowHeight: 50,
        virtualMaxHeight: '200px',
        rowHeight,
      });

      // Both rows fit within 200px at 50px each, so both should render.
      const dataRows = w.findAll('tbody tr').filter((tr) => !tr.attributes('aria-hidden'));
      expect(dataRows).toHaveLength(2);
    });
  });

  describe('mobile - sticky identity column', () => {
    it('first non-icon column header carries sticky left-0 z-[15] classes', () => {
      // Default columns: [name, status, icon] — name is the first non-icon column
      const w = factory();
      const nameHeader = w.findAll('thead th')[0];
      expect(nameHeader.classes()).toContain('sticky');
      expect(nameHeader.classes()).toContain('left-0');
      expect(nameHeader.classes()).toContain('z-[15]');
      expect(nameHeader.classes()).toContain('dd-sticky-col-left');
    });

    it('first non-icon column data cells carry sticky left-0 z-[15] classes', () => {
      const w = factory();
      const firstRowFirstCell = w.findAll('tbody tr')[0].findAll('td')[0];
      expect(firstRowFirstCell.classes()).toContain('sticky');
      expect(firstRowFirstCell.classes()).toContain('left-0');
      expect(firstRowFirstCell.classes()).toContain('z-[15]');
      expect(firstRowFirstCell.classes()).toContain('dd-sticky-col-left');
    });

    it('sticky-left header carries a background-color style for opaque stacking', () => {
      const w = factory();
      const nameHeader = w.findAll('thead th')[0];
      expect(nameHeader.attributes('style')).toContain('background-color');
    });

    it('skips sticky-left on an icon column and applies it to the first non-icon column', () => {
      const iconFirstCols = [
        { key: 'icon', label: '', icon: true },
        { key: 'name', label: 'Name' },
        { key: 'status', label: 'Status' },
      ];
      const w = mount(DataTable, {
        props: { columns: iconFirstCols, rows, rowKey: 'id' },
        global: { stubs: { AppIcon: { template: '<span />' } } },
      });
      const ths = w.findAll('thead th');
      // icon column (index 0) must NOT be sticky
      expect(ths[0].classes()).not.toContain('sticky');
      // name column (index 1) — first non-icon — must be sticky
      expect(ths[1].classes()).toContain('sticky');
      expect(ths[1].classes()).toContain('left-0');
      expect(ths[1].classes()).toContain('dd-sticky-col-left');
    });

    it('applies sticky-left to all data cells in the first non-icon column, not just the first row', () => {
      const w = factory();
      const trs = w.findAll('tbody tr');
      for (const tr of trs) {
        const cells = tr.findAll('td');
        expect(cells[0].classes()).toContain('sticky');
      }
    });

    it('non-first non-icon columns do not carry sticky-left', () => {
      const w = factory();
      // status column is index 1 (second non-icon)
      const statusHeader = w.findAll('thead th')[1];
      expect(statusHeader.classes()).not.toContain('sticky');
      const statusCell = w.findAll('tbody tr')[0].findAll('td')[1];
      expect(statusCell.classes()).not.toContain('sticky');
    });
  });

  describe('mobile - touch targets', () => {
    it('interactive data rows carry min-h-[44px]', () => {
      const w = factory();
      const trs = w.findAll('tbody tr');
      for (const tr of trs) {
        expect(tr.classes()).toContain('min-h-[44px]');
      }
    });

    it('non-interactive rows (via rowInteractive) do not carry min-h-[44px]', () => {
      const mixedRows = [
        { id: 'group-a', name: 'Group A', status: 'meta', kind: 'group' },
        ...rows,
      ];
      const w = factory({
        rows: mixedRows,
        rowInteractive: (row: { kind?: string }) => row.kind !== 'group',
      });
      const trs = w.findAll('tbody tr');
      expect(trs[0].classes()).not.toContain('min-h-[44px]');
      expect(trs[1].classes()).toContain('min-h-[44px]');
      expect(trs[2].classes()).toContain('min-h-[44px]');
      expect(trs[3].classes()).toContain('min-h-[44px]');
    });

    it('full-width group rows (fullWidthRow) do not carry min-h-[44px]', () => {
      const mixedRows = [
        { id: 'group-b', name: 'Group B', status: 'meta', kind: 'group' },
        ...rows,
      ];
      const w = factory({
        rows: mixedRows,
        fullWidthRow: (row: { kind?: string }) => row.kind === 'group',
      });
      const trs = w.findAll('tbody tr');
      expect(trs[0].classes()).not.toContain('min-h-[44px]');
      expect(trs[1].classes()).toContain('min-h-[44px]');
    });
  });

  describe('mobile - isMobile prop / resize handle', () => {
    it('shows resize handles by default (isMobile defaults to false)', () => {
      const w = factory({
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
        ],
      });
      expect(w.find('[role="separator"]').exists()).toBe(true);
    });

    it('hides all resize handles when isMobile is true', () => {
      const w = factory({
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
        ],
        isMobile: true,
      });
      expect(w.find('[role="separator"]').exists()).toBe(false);
    });

    it('shows resize handles when isMobile is explicitly false', () => {
      const w = factory({
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
        ],
        isMobile: false,
      });
      expect(w.find('[role="separator"]').exists()).toBe(true);
    });

    it('icon columns never have a resize handle regardless of isMobile', () => {
      const w = factory({ isMobile: false });
      // default columns has icon column at index 2 — it never gets a separator
      const iconHeader = w.findAll('thead th')[2];
      expect(iconHeader.find('[role="separator"]').exists()).toBe(false);
    });
  });
});
