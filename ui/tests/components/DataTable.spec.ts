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
      expect(nameTh.text()).toContain('▲');
    });

    it('shows descending indicator when sortAsc is false', () => {
      const w = factory({ sortKey: 'name', sortAsc: false });
      const nameTh = w.findAll('thead th')[0];
      expect(nameTh.text()).toContain('▼');
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
          'end-0',
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

    it('keeps the shared actions column sticky to the inline-end edge', () => {
      const w = factory({ showActions: true }, { actions: '<span class="action-btn">Act</span>' });
      const actionsHeader = w.findAll('thead th')[3];
      const actionsCell = w.findAll('tbody tr')[0].findAll('td')[3];

      expect(actionsHeader.classes()).toEqual(expect.arrayContaining(['sticky', 'end-0']));
      expect(actionsCell.classes()).toEqual(expect.arrayContaining(['sticky', 'end-0']));
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
      expect(actionsHeader.classes()).toEqual(expect.arrayContaining(['sticky', 'end-0']));
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
    it('first non-icon column header carries sticky start-0 z-20 classes', () => {
      // Default columns: [name, status, icon] — name is the first non-icon column
      const w = factory();
      const nameHeader = w.findAll('thead th')[0];
      expect(nameHeader.classes()).toContain('sticky');
      expect(nameHeader.classes()).toContain('start-0');
      expect(nameHeader.classes()).toContain('z-20');
      expect(nameHeader.classes()).toContain('dd-sticky-col-left');
    });

    it('first non-icon column data cells carry sticky start-0 z-10 classes', () => {
      const w = factory();
      const firstRowFirstCell = w.findAll('tbody tr')[0].findAll('td')[0];
      expect(firstRowFirstCell.classes()).toContain('sticky');
      expect(firstRowFirstCell.classes()).toContain('start-0');
      expect(firstRowFirstCell.classes()).toContain('z-10');
      expect(firstRowFirstCell.classes()).toContain('dd-sticky-col-left');
    });

    it('header sticky cell out-stacks the body sticky cell (z-20 > z-10)', () => {
      const w = factory();
      const nameHeader = w.findAll('thead th')[0];
      const firstRowFirstCell = w.findAll('tbody tr')[0].findAll('td')[0];
      expect(nameHeader.classes()).not.toContain('z-10');
      expect(firstRowFirstCell.classes()).not.toContain('z-20');
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
      expect(ths[1].classes()).toContain('start-0');
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
    it('interactive data rows carry min-h-[48px]', () => {
      const w = factory();
      const trs = w.findAll('tbody tr');
      for (const tr of trs) {
        expect(tr.classes()).toContain('min-h-[48px]');
      }
    });

    it('non-interactive rows (via rowInteractive) do not carry min-h-[48px]', () => {
      const mixedRows = [
        { id: 'group-a', name: 'Group A', status: 'meta', kind: 'group' },
        ...rows,
      ];
      const w = factory({
        rows: mixedRows,
        rowInteractive: (row: { kind?: string }) => row.kind !== 'group',
      });
      const trs = w.findAll('tbody tr');
      expect(trs[0].classes()).not.toContain('min-h-[48px]');
      expect(trs[1].classes()).toContain('min-h-[48px]');
      expect(trs[2].classes()).toContain('min-h-[48px]');
      expect(trs[3].classes()).toContain('min-h-[48px]');
    });

    it('full-width group rows (fullWidthRow) do not carry min-h-[48px]', () => {
      const mixedRows = [
        { id: 'group-b', name: 'Group B', status: 'meta', kind: 'group' },
        ...rows,
      ];
      const w = factory({
        rows: mixedRows,
        fullWidthRow: (row: { kind?: string }) => row.kind === 'group',
      });
      const trs = w.findAll('tbody tr');
      expect(trs[0].classes()).not.toContain('min-h-[48px]');
      expect(trs[1].classes()).toContain('min-h-[48px]');
    });
  });

  describe('accessibility - scroll container and header scope', () => {
    it('scroll container has overscroll-x-contain to prevent scroll chaining', () => {
      const w = factory();
      const scrollContainer = w.find('.overflow-x-auto');
      expect(scrollContainer.classes()).toContain('overscroll-x-contain');
    });

    it('scroll container does not carry a tabindex (preserves Android TalkBack table detection)', () => {
      const w = factory();
      const scrollContainer = w.find('.overflow-x-auto');
      expect(scrollContainer.attributes('tabindex')).toBeUndefined();
    });

    it('scroll container carries dd-data-table-scroll so print styles can un-clip it', () => {
      const w = factory();
      const scrollContainer = w.find('.overflow-x-auto');
      expect(scrollContainer.classes()).toContain('dd-data-table-scroll');
    });

    it('every data column header carries scope="col"', () => {
      const w = factory();
      const ths = w.findAll('thead th');
      for (const th of ths) {
        expect(th.attributes('scope')).toBe('col');
      }
    });

    it('the actions header carries scope="col"', () => {
      const w = factory({ showActions: true });
      const actionsHeader = w.findAll('thead th')[3];
      expect(actionsHeader.attributes('scope')).toBe('col');
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

  describe('card mode (container width < 640px)', () => {
    let originalClientWidthDescriptor: PropertyDescriptor | undefined;
    let mockedClientWidth = 0;

    beforeEach(() => {
      mockedClientWidth = 0;
      originalClientWidthDescriptor = Object.getOwnPropertyDescriptor(
        HTMLElement.prototype,
        'clientWidth',
      );
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get() {
          return mockedClientWidth;
        },
      });
    });

    afterEach(() => {
      if (originalClientWidthDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClientWidthDescriptor);
      } else {
        delete (HTMLElement.prototype as any).clientWidth;
      }
    });

    // `viewportWidth` is only assigned inside onMounted (via the ResizeObserver-backed
    // syncTableViewportWidth), so the isCardMode-dependent re-render is scheduled on the
    // next microtask tick rather than landing synchronously in mount(). Every caller must
    // await this helper before asserting on card-mode DOM.
    async function mountAtWidth(
      width: number,
      props: Record<string, any> = {},
      slots: Record<string, any> = {},
    ) {
      mockedClientWidth = width;
      const w = factory(props, slots);
      await nextTick();
      return w;
    }

    describe('mode switch', () => {
      it('stays in table mode when viewport width is 0 (pre-measurement)', async () => {
        const w = await mountAtWidth(0);
        expect(w.find('table').exists()).toBe(true);
        expect(w.find('ul[role="list"]').exists()).toBe(false);
      });

      it('stays in table mode when viewport width is >= 640', async () => {
        const w = await mountAtWidth(800);
        expect(w.find('table').exists()).toBe(true);
        expect(w.find('ul[role="list"]').exists()).toBe(false);
      });

      it('switches to card mode when 0 < viewport width < 640', async () => {
        const w = await mountAtWidth(500);
        expect(w.find('table').exists()).toBe(false);
        expect(w.find('ul[role="list"]').exists()).toBe(true);
      });
    });

    describe('card title + icon columns', () => {
      it('renders the first non-icon column as the card title via its cell slot', async () => {
        const w = await mountAtWidth(
          500,
          {},
          { 'cell-name': ({ row }: any) => `Custom: ${row.name}` },
        );
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-title"]').text()).toContain('Custom: Alpha');
      });

      it('falls back to the raw row value when no cell slot is provided', async () => {
        const w = await mountAtWidth(500);
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-title"]').text()).toBe('Alpha');
      });

      it('renders icon columns inline in the title row', async () => {
        const w = await mountAtWidth(
          500,
          {},
          { 'cell-icon': '<span class="icon-mark">ICON</span>' },
        );
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        const titleRow = firstCard.find('[data-test="dd-card-title-row"]');
        expect(titleRow.find('.icon-mark').exists()).toBe(true);
        expect(titleRow.text()).toContain('ICON');
      });

      it('does not render a title block when every column is an icon column', async () => {
        const iconOnlyColumns = [{ key: 'icon', label: '', icon: true }];
        const w = await mountAtWidth(500, { columns: iconOnlyColumns });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-title"]').exists()).toBe(false);
      });

      it('uses the column flagged cardTitle as the card title, overriding declared order', async () => {
        const flaggedColumns = [
          { key: 'icon', label: '', icon: true },
          { key: 'first', label: 'First' },
          { key: 'name', label: 'Name', cardTitle: true },
        ];
        const flaggedRows = [{ id: '1', first: 'F1', name: 'Alpha' }];
        const w = await mountAtWidth(500, { columns: flaggedColumns, rows: flaggedRows });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-title"]').text()).toBe('Alpha');
      });

      it('table mode ignores cardTitle and keeps the sticky column at the first non-icon column', async () => {
        const flaggedColumns = [
          { key: 'icon', label: '', icon: true },
          { key: 'first', label: 'First' },
          { key: 'name', label: 'Name', cardTitle: true },
        ];
        const w = await mountAtWidth(800, { columns: flaggedColumns });
        const stickyHeader = w
          .findAll('thead th')
          .find((th) => th.classes().includes('dd-sticky-col-left'));
        expect(stickyHeader?.attributes('data-col-key')).toBe('first');
      });
    });

    describe('card subtitle', () => {
      it('falls back to the 2nd non-icon column by order when no cardPriority is set', async () => {
        const w = await mountAtWidth(500);
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-subtitle"]').text()).toBe('running');
      });

      it('uses the highest-cardPriority non-icon, non-title column when cardPriority is set', async () => {
        const prioritizedColumns = [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', cardPriority: 5 },
          { key: 'host', label: 'Host', cardPriority: 10 },
          { key: 'region', label: 'Region', cardPriority: 3 },
        ];
        const prioritizedRows = [
          { id: '1', name: 'Alpha', status: 'running', host: 'node-1', region: 'us-east' },
        ];
        const w = await mountAtWidth(500, { columns: prioritizedColumns, rows: prioritizedRows });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-subtitle"]').text()).toBe('node-1');
      });

      it('breaks cardPriority ties by declared order', async () => {
        const tiedColumns = [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', cardPriority: 5 },
          { key: 'host', label: 'Host', cardPriority: 5 },
        ];
        const tiedRows = [{ id: '1', name: 'Alpha', status: 'running', host: 'node-1' }];
        const w = await mountAtWidth(500, { columns: tiedColumns, rows: tiedRows });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-subtitle"]').text()).toBe('running');
      });

      it('does not render a subtitle block when there is no non-title non-icon column', async () => {
        const soleColumn = [{ key: 'name', label: 'Name' }];
        const w = await mountAtWidth(500, { columns: soleColumn });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-subtitle"]').exists()).toBe(false);
      });

      it('excludes a negative cardPriority column from the subtitle fallback', async () => {
        const demotedColumns = [
          { key: 'name', label: 'Name' },
          { key: 'server', label: 'Server', cardPriority: -1 },
          { key: 'status', label: 'Status' },
        ];
        const demotedRows = [{ id: '1', name: 'Alpha', server: 'srv-1', status: 'running' }];
        const w = await mountAtWidth(500, { columns: demotedColumns, rows: demotedRows });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        // Fallback skips the negative-priority column and lands on the next candidate by order.
        expect(firstCard.find('[data-test="dd-card-subtitle"]').text()).toBe('running');
      });

      it('ignores the priority field for card composition (auto-hide priority is not card priority)', async () => {
        const legacyPriorityColumns = [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', priority: 5 },
          { key: 'host', label: 'Host', priority: 10 },
          { key: 'region', label: 'Region', priority: 3 },
        ];
        const legacyPriorityRows = [
          { id: '1', name: 'Alpha', status: 'running', host: 'node-1', region: 'us-east' },
        ];
        const w = await mountAtWidth(500, {
          columns: legacyPriorityColumns,
          rows: legacyPriorityRows,
        });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        // `priority` alone no longer selects the subtitle — falls back to the first candidate
        // by declared order (status), not the highest `priority` value (host).
        expect(firstCard.find('[data-test="dd-card-subtitle"]').text()).toBe('running');
      });
    });

    describe('card body', () => {
      it('renders remaining non-icon columns as dt/dd pairs using cell slots and cellContentClass', async () => {
        const columnsWithWrap = [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
          { key: 'notes', label: 'Notes', overflow: 'wrap' as const },
          { key: 'icon', label: '', icon: true },
        ];
        const rowsWithNotes = [{ id: '1', name: 'Alpha', status: 'running', notes: 'Some notes' }];
        const w = await mountAtWidth(
          500,
          { columns: columnsWithWrap, rows: rowsWithNotes },
          { 'cell-notes': ({ value }: any) => `Notes: ${value}` },
        );
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        const body = firstCard.find('[data-test="dd-card-body"]');
        expect(body.exists()).toBe(true);
        const dts = body.findAll('dt');
        const dds = body.findAll('dd');
        expect(dts).toHaveLength(1);
        expect(dts[0].text()).toBe('Notes');
        expect(dds[0].text()).toContain('Notes: Some notes');
        expect(dds[0].classes()).toContain('whitespace-normal');
      });

      it('does not render a body dl when no columns remain after title and subtitle', async () => {
        const twoColumns = [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
        ];
        const w = await mountAtWidth(500, { columns: twoColumns });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-body"]').exists()).toBe(false);
      });

      it('excludes a negative cardPriority column from the card body while keeping other body columns', async () => {
        const demotedColumns = [
          { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status', cardPriority: 1 },
          { key: 'server', label: 'Server', cardPriority: -1 },
          { key: 'notes', label: 'Notes' },
        ];
        const demotedRows = [
          { id: '1', name: 'Alpha', status: 'running', server: 'srv-1', notes: 'ok' },
        ];
        const w = await mountAtWidth(500, { columns: demotedColumns, rows: demotedRows });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-subtitle"]').text()).toBe('running');
        const body = firstCard.find('[data-test="dd-card-body"]');
        const dts = body.findAll('dt');
        expect(dts.map((dt) => dt.text())).toEqual(['Notes']);
      });
    });

    describe('card actions', () => {
      it('renders the actions slot in a footer region when showActions is true', async () => {
        const w = await mountAtWidth(
          500,
          { showActions: true },
          { actions: '<button class="act">Act</button>' },
        );
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        const actions = firstCard.find('[data-test="dd-card-actions"]');
        expect(actions.exists()).toBe(true);
        expect(actions.find('.act').exists()).toBe(true);
      });

      it('does not render a footer region when showActions is false', async () => {
        const w = await mountAtWidth(500, { showActions: false });
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.find('[data-test="dd-card-actions"]').exists()).toBe(false);
      });
    });

    describe('interactivity + selection', () => {
      it('gives interactive cards a tabindex and emits row-click on click', async () => {
        const w = await mountAtWidth(500);
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.attributes('tabindex')).toBe('0');
        await firstCard.trigger('click');
        expect(w.emitted('row-click')?.[0]).toEqual([rows[0]]);
      });

      it('emits row-click on Enter and Space keydown for interactive cards', async () => {
        const w = await mountAtWidth(500);
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        await firstCard.trigger('keydown', { key: 'Enter' });
        expect(w.emitted('row-click')?.[0]).toEqual([rows[0]]);
        await firstCard.trigger('keydown', { key: ' ' });
        expect(w.emitted('row-click')?.[1]).toEqual([rows[0]]);
      });

      it('does not set tabindex or emit row-click for non-interactive rows', async () => {
        const mixedRows = [
          { id: 'group-a', name: 'Group A', status: 'meta', kind: 'group' },
          ...rows,
        ];
        const w = await mountAtWidth(500, {
          rows: mixedRows,
          rowInteractive: (row: { kind?: string }) => row.kind !== 'group',
        });
        const cards = w.findAll('[data-test="dd-card"]');
        expect(cards[0].attributes('tabindex')).toBeUndefined();
        await cards[0].trigger('click');
        expect(w.emitted('row-click')).toBeUndefined();
      });

      it('renders the full-row slot for fullWidthRow rows instead of a card', async () => {
        const mixedRows = [
          { id: 'group-a', name: 'Group A', status: 'meta', kind: 'group' },
          ...rows,
        ];
        const w = await mountAtWidth(
          500,
          { rows: mixedRows, fullWidthRow: (row: { kind?: string }) => row.kind === 'group' },
          { 'full-row': ({ row }: any) => `<div class="full-row">Header: ${row.name}</div>` },
        );
        const listItems = w.findAll('ul[role="list"] > li');
        // First li is the group row rendered via the full-row slot (not a .dd-card).
        expect(listItems[0].text()).toContain('Header: Group A');
        expect(listItems[0].find('[data-test="dd-card"]').exists()).toBe(false);
        expect(w.findAll('[data-test="dd-card"]')).toHaveLength(rows.length);
      });

      it('applies the selected-state class when selectedKey matches the row', async () => {
        const w = await mountAtWidth(500, { selectedKey: '2' });
        const cards = w.findAll('[data-test="dd-card"]');
        expect(cards[1].classes()).toContain('dd-data-table-card-selected');
        expect(cards[0].classes()).not.toContain('dd-data-table-card-selected');
      });
    });

    describe('sort controls', () => {
      const sortColumns = [
        { key: 'name', label: 'Name', sortable: true },
        { key: 'status', label: 'Status', sortable: true },
        { key: 'icon', label: '', icon: true },
        { key: 'notSortable', label: 'Fixed', sortable: false },
      ];
      const sortRows = [{ id: '1', name: 'Alpha', status: 'running', notSortable: 'x' }];

      it('lists only sortable, non-icon columns as options', async () => {
        const w = await mountAtWidth(500, {
          columns: sortColumns,
          rows: sortRows,
          sortKey: 'name',
          sortAsc: true,
        });
        const options = w
          .find('[data-test="dd-card-sort-select"]')
          .findAll('option:not([disabled])');
        expect(options.map((o) => o.attributes('value'))).toEqual(['name', 'status']);
      });

      it('keeps a negative-cardPriority column in the sort select even though it is demoted from the card', async () => {
        const demotedSortColumns = [
          { key: 'name', label: 'Name', sortable: true },
          { key: 'server', label: 'Server', cardPriority: -1, sortable: true },
        ];
        const demotedSortRows = [{ id: '1', name: 'Alpha', server: 'srv-1' }];
        const w = await mountAtWidth(500, { columns: demotedSortColumns, rows: demotedSortRows });
        const options = w
          .find('[data-test="dd-card-sort-select"]')
          .findAll('option:not([disabled])');
        expect(options.map((o) => o.attributes('value'))).toEqual(['name', 'server']);
      });

      it('reflects sortKey as the selected value', async () => {
        const w = await mountAtWidth(500, {
          columns: sortColumns,
          rows: sortRows,
          sortKey: 'status',
          sortAsc: true,
        });
        const select = w.find('[data-test="dd-card-sort-select"]');
        expect((select.element as HTMLSelectElement).value).toBe('status');
      });

      it('emits update:sortKey and update:sortAsc(true) when a new column is selected', async () => {
        const w = await mountAtWidth(500, {
          columns: sortColumns,
          rows: sortRows,
          sortKey: 'name',
          sortAsc: false,
        });
        const select = w.find('[data-test="dd-card-sort-select"]');
        await select.setValue('status');
        expect(w.emitted('update:sortKey')?.[0]).toEqual(['status']);
        expect(w.emitted('update:sortAsc')?.[0]).toEqual([true]);
      });

      it('does nothing when re-selecting the current sortKey', async () => {
        const w = await mountAtWidth(500, {
          columns: sortColumns,
          rows: sortRows,
          sortKey: 'name',
          sortAsc: true,
        });
        const select = w.find('[data-test="dd-card-sort-select"]');
        await select.setValue('name');
        expect(w.emitted('update:sortKey')).toBeUndefined();
        expect(w.emitted('update:sortAsc')).toBeUndefined();
      });

      it('ignores an empty selection value', async () => {
        const w = await mountAtWidth(500, {
          columns: sortColumns,
          rows: sortRows,
          sortKey: 'name',
          sortAsc: true,
        });
        const select = w.find('[data-test="dd-card-sort-select"]').element as HTMLSelectElement;
        select.value = '';
        await select.dispatchEvent(new Event('change'));
        expect(w.emitted('update:sortKey')).toBeUndefined();
      });

      it('flips sortAsc via the direction toggle button', async () => {
        const w = await mountAtWidth(500, {
          columns: sortColumns,
          rows: sortRows,
          sortKey: 'name',
          sortAsc: true,
        });
        const button = w.find('[data-test="dd-card-sort-direction"]');
        await button.trigger('click');
        expect(w.emitted('update:sortAsc')?.[0]).toEqual([false]);
        expect(w.emitted('update:sortKey')).toBeUndefined();
      });

      it('disables the direction toggle button when no sortKey is set', async () => {
        const w = await mountAtWidth(500, { columns: sortColumns, rows: sortRows });
        const button = w.find('[data-test="dd-card-sort-direction"]');
        expect(button.attributes('disabled')).toBeDefined();
      });

      it('does not render sort controls when there are no sortable columns', async () => {
        const noSortCols = [{ key: 'name', label: 'Name', sortable: false }];
        const w = await mountAtWidth(500, { columns: noSortCols });
        expect(w.find('[data-test="dd-card-sort-select"]').exists()).toBe(false);
      });

      it('does not render sort controls when rows are empty', async () => {
        const w = await mountAtWidth(
          500,
          { columns: sortColumns, rows: [] },
          { empty: '<div class="empty-msg">No data</div>' },
        );
        expect(w.find('[data-test="dd-card-sort-select"]').exists()).toBe(false);
        expect(w.find('.empty-msg').exists()).toBe(true);
      });

      it('marks the sort bar wrapper with dd-data-table-card-sort-bar so print styles can hide it', async () => {
        const w = await mountAtWidth(500, { columns: sortColumns, rows: sortRows });
        expect(w.find('.dd-data-table-card-sort-bar').exists()).toBe(true);
        expect(
          w.find('.dd-data-table-card-sort-bar [data-test="dd-card-sort-select"]').exists(),
        ).toBe(true);
      });
    });

    describe('virtual scroll spacers', () => {
      function makeRows(count: number) {
        return Array.from({ length: count }, (_, i) => ({
          id: `${i + 1}`,
          name: `Container ${i + 1}`,
          status: i % 2 === 0 ? 'running' : 'stopped',
        }));
      }

      it('renders a top spacer <li> in card mode once virtual scroll windowing skips rows', async () => {
        const manyRows = makeRows(200);
        const w = await mountAtWidth(500, {
          rows: manyRows,
          virtualScroll: true,
          virtualRowHeight: 40,
          virtualMaxHeight: '120px',
        });

        expect(w.find('[data-test="dd-card-top-spacer"]').exists()).toBe(false);
        // 200 rows never fit in a 120px window, so trailing rows are windowed out from the start.
        expect(w.find('[data-test="dd-card-bottom-spacer"]').exists()).toBe(true);

        const scrollViewport = w.find('[data-test="data-table-scroll"]');
        (scrollViewport.element as HTMLElement).scrollTop = 1200;
        await scrollViewport.trigger('scroll');

        expect(w.find('[data-test="dd-card-top-spacer"]').exists()).toBe(true);
        expect(w.find('[data-test="dd-card-bottom-spacer"]').exists()).toBe(true);
      });
    });

    describe('touch targets + logical (RTL-safe) properties', () => {
      it('interactive cards and sort controls carry >=44px touch target classes', async () => {
        const w = await mountAtWidth(
          500,
          { showActions: true, sortKey: 'name' },
          { actions: '<button>Act</button>' },
        );
        const firstCard = w.findAll('[data-test="dd-card"]')[0];
        expect(firstCard.classes()).toContain('min-h-[48px]');
        expect(w.find('[data-test="dd-card-sort-select"]').classes()).toContain('min-h-[44px]');
        // Direction toggle renders via AppButton size="icon-md", which is a 44x44px (w-11 h-11) target.
        expect(w.find('[data-test="dd-card-sort-direction"]').classes()).toEqual(
          expect.arrayContaining(['w-11', 'h-11']),
        );
        expect(w.find('[data-test="dd-card-actions"]').classes()).toContain('min-h-[44px]');
      });

      it('uses only logical (start/end) properties, never physical left/right classes', async () => {
        const w = await mountAtWidth(
          500,
          { showActions: true, sortKey: 'name' },
          { actions: '<button>Act</button>' },
        );
        const html = w.html();
        expect(html).not.toMatch(/\bleft-0\b/);
        expect(html).not.toMatch(/\bright-0\b/);
        expect(html).not.toMatch(/\bpl-\d/);
        expect(html).not.toMatch(/\bpr-\d/);
        expect(html).not.toMatch(/\bml-\d/);
        expect(html).not.toMatch(/\bmr-\d/);
      });
    });

    describe('empty state', () => {
      it('still renders the empty slot in card mode when rows is empty', async () => {
        const w = await mountAtWidth(
          500,
          { rows: [] },
          { empty: '<div class="empty-msg">No data</div>' },
        );
        expect(w.find('.empty-msg').exists()).toBe(true);
      });
    });
  });
});
