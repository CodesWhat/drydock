import { mergeDefaults, migrate, migrateFromLegacyKeys } from '@/preferences/migrate';
import { DEFAULTS } from '@/preferences/schema';

const LEGACY_KEYS = [
  'drydock-theme-family-v1',
  'drydock-theme-variant-v1',
  'drydock-font-family-v1',
  'drydock-icon-library-v1',
  'drydock-icon-scale-v1',
  'drydock-radius-v1',
  'dd-sidebar-v1',
  'dd-table-cols-v1',
  'dd-containers-filters-v1',
  'dd-containers-sort-v1',
  'dd-containers-view-v1',
  'dd-table-actions-v1',
  'dd-group-by-stack-v1',
  'dd-dashboard-widget-order-v3',
  'dd-security-view-v1',
  'dd-security-sort-field-v1',
  'dd-security-sort-asc-v1',
  'dd-audit-view-v1',
  'dd-agents-view-v1',
  'dd-agents-sort-key-v1',
  'dd-agents-sort-asc-v1',
  'dd-triggers-view-v1',
  'dd-watchers-view-v1',
  'dd-servers-view-v1',
  'dd-registries-view-v1',
  'dd-notifications-view-v1',
  'dd-auth-view-v1',
] as const;

describe('preferences migration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('mergeDefaults', () => {
    it('should return full defaults when source is empty', () => {
      const result = mergeDefaults({});
      expect(result).toEqual(DEFAULTS);
    });

    it('should override top-level scalar values', () => {
      const result = mergeDefaults({ schemaVersion: 2 });
      expect(result.schemaVersion).toBe(2);
    });

    it('should deep-merge nested objects', () => {
      const result = mergeDefaults({ theme: { family: 'github' } });
      expect(result.theme.family).toBe('github');
      // Should preserve default variant
      expect(result.theme.variant).toBe('dark');
    });

    it('should replace arrays from source', () => {
      const result = mergeDefaults({ containers: { columns: ['name', 'status'] } });
      expect(result.containers.columns).toEqual(['name', 'status']);
    });

    it('should not add unknown keys', () => {
      const result = mergeDefaults({ unknownKey: 'value' } as any);
      expect('unknownKey' in result).toBe(false);
    });

    it('should fill missing nested keys with defaults', () => {
      const result = mergeDefaults({ containers: { tableActions: 'buttons' } });
      expect(result.containers.tableActions).toBe('buttons');
      expect(result.containers.groupByStack).toBe(false);
      expect(result.containers.sort).toEqual({ key: 'name', asc: true });
    });
  });

  describe('migrate', () => {
    it('should return merged defaults for schemaVersion 1 data and upgrade the schema version', () => {
      const result = migrate({ schemaVersion: 1, theme: { family: 'dracula' } });
      expect(result.schemaVersion).toBe(DEFAULTS.schemaVersion);
      expect(result.theme.family).toBe('dracula');
      expect(result.theme.variant).toBe('dark');
    });

    it('should fill missing fields from defaults', () => {
      const result = migrate({ schemaVersion: 1 });
      expect(result).toEqual(DEFAULTS);
    });

    it('should replace removed theme family with default', () => {
      const result = migrate({ schemaVersion: 1, theme: { family: 'drydock', variant: 'dark' } });
      expect(result.theme.family).toBe(DEFAULTS.theme.family);
      expect(result.theme.variant).toBe('dark');
    });

    it('should replace invalid theme variant with default', () => {
      const result = migrate({
        schemaVersion: 1,
        theme: { family: 'github', variant: 'invalid' },
      });
      expect(result.theme.family).toBe('github');
      expect(result.theme.variant).toBe(DEFAULTS.theme.variant);
    });

    it('should replace invalid font family with default', () => {
      const result = migrate({ schemaVersion: 1, font: { family: 'comic-sans' } });
      expect(result.font.family).toBe(DEFAULTS.font.family);
    });

    it('should replace invalid icon library with default', () => {
      const result = migrate({ schemaVersion: 1, icons: { library: 'removed-lib', scale: 1 } });
      expect(result.icons.library).toBe(DEFAULTS.icons.library);
      expect(result.icons.scale).toBe(1);
    });

    it('should replace invalid icon scale with default', () => {
      const result = migrate({ schemaVersion: 1, icons: { library: 'lucide', scale: 99 } });
      expect(result.icons.library).toBe('lucide');
      expect(result.icons.scale).toBe(DEFAULTS.icons.scale);
    });

    it('should replace invalid radius with default', () => {
      const result = migrate({ schemaVersion: 1, appearance: { radius: 'huge' } });
      expect(result.appearance.radius).toBe(DEFAULTS.appearance.radius);
    });

    it('should replace invalid fontSize with default', () => {
      const result = migrate({ schemaVersion: 1, appearance: { fontSize: 5 } });
      expect(result.appearance.fontSize).toBe(DEFAULTS.appearance.fontSize);
    });

    it('should add the table width preference bucket when migrating older schema data', () => {
      const result = migrate({ schemaVersion: 1 });
      expect(result.tables.columnWidths).toEqual({});
    });

    it('should upgrade schema v5 preferences to the current version when adding table widths', () => {
      const result = migrate({
        schemaVersion: 5,
        tables: { columnWidths: { containers: { name: 360 } } },
      });

      expect(result.schemaVersion).toBe(DEFAULTS.schemaVersion);
      expect(result.tables.columnWidths.containers.name).toBe(360);
    });

    it('should preserve valid table width preferences and drop invalid ones', () => {
      const result = migrate({
        schemaVersion: 1,
        tables: {
          columnWidths: {
            containers: { name: 360, version: 220, badSmall: 10, badLarge: 9000 },
            invalid: 'not-a-record',
          },
        },
      });

      expect(result.tables.columnWidths).toEqual({
        containers: { name: 360, version: 220 },
      });
    });

    it('should preserve defaults when table widths are omitted', () => {
      const result = migrate({
        schemaVersion: 1,
        tables: {},
      });

      expect(result.tables.columnWidths).toEqual({});
    });

    it('should drop invalid table width buckets', () => {
      const result = migrate({
        schemaVersion: 1,
        tables: {
          columnWidths: 'invalid-widths',
        },
      });

      expect(result.tables.columnWidths).toEqual({});
    });

    it('should drop table width entries left empty after sanitization', () => {
      const result = migrate({
        schemaVersion: 1,
        tables: {
          columnWidths: {
            containers: { tooSmall: 10 },
          },
        },
      });

      expect(result.tables.columnWidths).toEqual({});
    });

    it('should drop malformed table preferences', () => {
      const result = migrate({ schemaVersion: 1, tables: 'invalid-tables' });
      expect(result.tables.columnWidths).toEqual({});
    });

    it('should preserve valid fontSize', () => {
      const result = migrate({ schemaVersion: 1, appearance: { fontSize: 1.1 } });
      expect(result.appearance.fontSize).toBe(1.1);
    });

    it('should preserve a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'zh-CN' } });
      expect(result.locale.language).toBe('zh-CN');
    });

    it('should preserve Traditional Chinese as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'zh-TW' } });
      expect(result.locale.language).toBe('zh-TW');
    });

    it('should preserve Italian as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'it' } });
      expect(result.locale.language).toBe('it');
    });

    it('should preserve Spanish as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'es' } });
      expect(result.locale.language).toBe('es');
    });

    it('should preserve German as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'de' } });
      expect(result.locale.language).toBe('de');
    });

    it('should preserve French as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'fr' } });
      expect(result.locale.language).toBe('fr');
    });

    it('should preserve Brazilian Portuguese as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'pt-BR' } });
      expect(result.locale.language).toBe('pt-BR');
    });

    it('should preserve Dutch as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'nl' } });
      expect(result.locale.language).toBe('nl');
    });

    it('should preserve Polish as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'pl' } });
      expect(result.locale.language).toBe('pl');
    });

    it('should preserve Turkish as a supported locale', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'tr' } });
      expect(result.locale.language).toBe('tr');
    });

    it('should drop malformed locale preferences', () => {
      const result = migrate({ schemaVersion: 1, locale: 'zh-TW' });
      expect(result.locale.language).toBe(DEFAULTS.locale.language);
    });

    it('should replace an unsupported locale with the default', () => {
      const result = migrate({ schemaVersion: 1, locale: { language: 'xx' } });
      expect(result.locale.language).toBe(DEFAULTS.locale.language);
    });

    it('should drop unknown container fields (viewMode was removed in v8)', () => {
      const result = migrate({ schemaVersion: 1, containers: { viewMode: 'timeline' } });
      expect((result.containers as any).viewMode).toBeUndefined();
    });

    it('should replace invalid tableActions with default', () => {
      const result = migrate({ schemaVersion: 1, containers: { tableActions: 'links' } });
      expect(result.containers.tableActions).toBe(DEFAULTS.containers.tableActions);
    });

    it('should replace invalid container columns with default', () => {
      const result = migrate({ schemaVersion: 1, containers: { columns: 'name' as any } });
      expect(result.containers.columns).toEqual(DEFAULTS.containers.columns);
    });

    it('should preserve dashboard gridLayout through migration (#223)', () => {
      const gridLayout = [
        { i: 'host-status', x: 10, y: 11, w: 4, h: 6 },
        { i: 'recent-updates', x: 0, y: 0, w: 12, h: 8 },
      ];
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['host-status', 'recent-updates'],
          hiddenWidgets: [],
          gridLayout,
        },
      });
      expect(result.dashboard.gridLayout).toEqual(gridLayout);
    });

    it('should migrate legacy desktop gridLayout into responsive dashboard layouts', () => {
      const gridLayout = [
        { i: 'host-status', x: 10, y: 11, w: 4, h: 6 },
        { i: 'recent-updates', x: 0, y: 0, w: 12, h: 8 },
      ];
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['host-status', 'recent-updates'],
          hiddenWidgets: [],
          gridLayout,
        },
      });

      expect(result.dashboard.gridLayouts.lg).toEqual(gridLayout);
    });

    it('should migrate legacy single-column gridLayout into mobile dashboard layouts', () => {
      const gridLayout = [
        { i: 'stat-containers', x: 0, y: 0, w: 1, h: 3 },
        { i: 'recent-updates', x: 0, y: 3, w: 1, h: 10 },
      ];
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['stat-containers', 'recent-updates'],
          hiddenWidgets: [],
          gridLayout,
        },
      });

      expect(result.dashboard.gridLayouts.sm).toEqual(gridLayout);
    });

    it('should treat non-record legacy grid items as desktop layouts', () => {
      const gridLayout = [null, { i: 'recent-updates', x: 0, y: 3, w: 1, h: 10 }] as any;
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['recent-updates'],
          hiddenWidgets: [],
          gridLayout,
        },
      });

      expect(result.dashboard.gridLayouts.lg).toEqual(gridLayout);
    });

    it('should drop non-object responsive gridLayouts before migrating legacy layouts', () => {
      const gridLayout = [{ i: 'host-status', x: 8, y: 3, w: 4, h: 6 }];
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['host-status'],
          hiddenWidgets: [],
          gridLayout,
          gridLayouts: 'invalid-layouts' as any,
        },
      });

      expect(result.dashboard.gridLayouts.lg).toEqual(gridLayout);
    });

    it('should preserve defaults when responsive gridLayouts key is absent', () => {
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['host-status'],
          hiddenWidgets: [],
        },
      });

      expect(result.dashboard.gridLayouts).toEqual(DEFAULTS.dashboard.gridLayouts);
    });

    it('should keep valid responsive dashboard layouts and discard invalid entries', () => {
      const desktopLayout = [{ i: 'host-status', x: 8, y: 3, w: 4, h: 6 }];
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['host-status'],
          hiddenWidgets: [],
          gridLayout: [{ i: 'host-status', x: 0, y: 0, w: 1, h: 3 }],
          gridLayouts: {
            lg: desktopLayout,
            invalid: desktopLayout,
            sm: 'not-an-array',
          },
        },
      });

      expect(result.dashboard.gridLayouts).toEqual({
        ...DEFAULTS.dashboard.gridLayouts,
        lg: desktopLayout,
      });
    });

    it('should drop non-array legacy gridLayout values', () => {
      const result = migrate({
        schemaVersion: 1,
        dashboard: {
          widgetOrder: ['host-status'],
          hiddenWidgets: [],
          gridLayout: { i: 'host-status' } as any,
        },
      });

      expect(result.dashboard.gridLayout).toEqual(DEFAULTS.dashboard.gridLayout);
      expect(result.dashboard.gridLayouts).toEqual(DEFAULTS.dashboard.gridLayouts);
    });

    it('should preserve all valid values through sanitization', () => {
      const input = {
        schemaVersion: 1,
        theme: { family: 'catppuccin', variant: 'light' },
        font: { family: 'jetbrains-mono' },
        icons: { library: 'tabler', scale: 1.2 },
        appearance: { radius: 'round', fontSize: 1.15 },
        containers: { tableActions: 'buttons' },
      };
      const result = migrate(input);
      expect(result.theme).toEqual({ family: 'catppuccin', variant: 'light' });
      expect(result.font.family).toBe('jetbrains-mono');
      expect(result.icons).toEqual({ library: 'tabler', scale: 1.2 });
      expect(result.appearance.radius).toBe('round');
      expect(result.appearance.fontSize).toBe(1.15);
      expect(result.containers.tableActions).toBe('buttons');
    });

    it('should add the shared log sort preference when migrating older schema data', () => {
      const result = migrate({ schemaVersion: 1, views: { triggers: { mode: 'cards' } } });

      expect(result.views.logs.newestFirst).toBe(DEFAULTS.views.logs.newestFirst);
      expect(result.views.triggers).toEqual({});
    });

    it('should preserve the shared log sort preference in current schema data', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          logs: { newestFirst: true },
        },
      });

      expect(result.views.logs.newestFirst).toBe(true);
    });

    it('should reset invalid log view objects to defaults', () => {
      const result = migrate({
        schemaVersion: 1,
        views: {
          logs: 'invalid' as any,
        },
      });

      expect(result.views.logs).toEqual(DEFAULTS.views.logs);
    });

    it('should delete non-record logs value during sanitization of current schema data', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          logs: 42 as any,
        },
      });

      expect(result.views.logs).toEqual(DEFAULTS.views.logs);
    });

    it('should reset invalid log newestFirst values to defaults', () => {
      const result = migrate({
        schemaVersion: 1,
        views: {
          logs: { newestFirst: 'yes' as any },
        },
      });

      expect(result.views.logs.newestFirst).toBe(DEFAULTS.views.logs.newestFirst);
    });
  });

  describe('schema v6 → v7 migration (softwareVersion column)', () => {
    it('should add softwareVersion column when migrating from schemaVersion 6', () => {
      const result = migrate({
        schemaVersion: 6,
        containers: {
          columns: ['icon', 'name', 'version', 'kind', 'status', 'server', 'registry'],
        },
      });
      expect(result.schemaVersion).toBe(DEFAULTS.schemaVersion);
      const idx = result.containers.columns.indexOf('softwareVersion');
      expect(idx).toBeGreaterThan(-1);
      const versionIdx = result.containers.columns.indexOf('version');
      expect(idx).toBe(versionIdx + 1);
    });

    it('should not duplicate softwareVersion if already present when migrating from schemaVersion 6', () => {
      const result = migrate({
        schemaVersion: 6,
        containers: {
          columns: [
            'icon',
            'name',
            'version',
            'softwareVersion',
            'kind',
            'status',
            'server',
            'registry',
          ],
        },
      });
      const occurrences = result.containers.columns.filter((c) => c === 'softwareVersion').length;
      expect(occurrences).toBe(1);
    });

    it('should still upgrade to schemaVersion 7 when containers.columns is not a string array', () => {
      const result = migrate({
        schemaVersion: 6,
        containers: { columns: 'name' as any },
      });
      expect(result.schemaVersion).toBe(DEFAULTS.schemaVersion);
    });

    it('should add softwareVersion when version column is absent (appends at end before sanitize)', () => {
      const result = migrate({
        schemaVersion: 6,
        containers: { columns: ['icon', 'name', 'kind', 'status'] },
      });
      expect(result.schemaVersion).toBe(DEFAULTS.schemaVersion);
      expect(result.containers.columns.includes('softwareVersion')).toBe(true);
    });

    it('DEFAULTS should include softwareVersion in containers.columns', () => {
      expect(DEFAULTS.containers.columns.includes('softwareVersion')).toBe(true);
    });
  });

  describe('migrateFromLegacyKeys', () => {
    it('handles localStorage getter failures while reading legacy string keys', () => {
      const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('storage unavailable');
      });

      const result = migrateFromLegacyKeys();

      expect(result).toEqual(DEFAULTS);
      getItemSpy.mockRestore();
    });

    it('falls back to defaults when an individual string-key read throws', () => {
      localStorage.setItem('drydock-theme-family-v1', 'github');
      const originalGetItem = localStorage.getItem.bind(localStorage);
      const getItemSpy = vi.spyOn(localStorage, 'getItem').mockImplementation((key: string) => {
        if (key === 'drydock-theme-family-v1') {
          throw new Error('read failed');
        }
        return originalGetItem(key);
      });

      const result = migrateFromLegacyKeys();

      expect(result.theme.family).toBe(DEFAULTS.theme.family);
      getItemSpy.mockRestore();
    });

    describe('theme migration', () => {
      it('should migrate theme family', () => {
        localStorage.setItem('drydock-theme-family-v1', 'github');
        const result = migrateFromLegacyKeys();
        expect(result.theme.family).toBe('github');
      });

      it('should migrate theme variant', () => {
        localStorage.setItem('drydock-theme-variant-v1', 'light');
        const result = migrateFromLegacyKeys();
        expect(result.theme.variant).toBe('light');
      });

      it('should migrate both family and variant', () => {
        localStorage.setItem('drydock-theme-family-v1', 'catppuccin');
        localStorage.setItem('drydock-theme-variant-v1', 'system');
        const result = migrateFromLegacyKeys();
        expect(result.theme.family).toBe('catppuccin');
        expect(result.theme.variant).toBe('system');
      });

      it('should ignore invalid theme family', () => {
        localStorage.setItem('drydock-theme-family-v1', 'invalid-theme');
        const result = migrateFromLegacyKeys();
        expect(result.theme.family).toBe(DEFAULTS.theme.family);
      });

      it('should ignore invalid theme variant', () => {
        localStorage.setItem('drydock-theme-variant-v1', 'invalid-variant');
        const result = migrateFromLegacyKeys();
        expect(result.theme.variant).toBe(DEFAULTS.theme.variant);
      });
    });

    describe('font migration', () => {
      it('should migrate font family', () => {
        localStorage.setItem('drydock-font-family-v1', 'jetbrains-mono');
        const result = migrateFromLegacyKeys();
        expect(result.font.family).toBe('jetbrains-mono');
      });

      it('should ignore invalid font family', () => {
        localStorage.setItem('drydock-font-family-v1', 'invalid-font');
        const result = migrateFromLegacyKeys();
        expect(result.font.family).toBe(DEFAULTS.font.family);
      });
    });

    describe('icon migration', () => {
      it('should migrate icon library', () => {
        localStorage.setItem('drydock-icon-library-v1', 'lucide');
        const result = migrateFromLegacyKeys();
        expect(result.icons.library).toBe('lucide');
      });

      it('should ignore invalid icon library', () => {
        localStorage.setItem('drydock-icon-library-v1', 'ph-bold');
        const result = migrateFromLegacyKeys();
        expect(result.icons.library).toBe(DEFAULTS.icons.library);
      });

      it('should migrate icon scale', () => {
        localStorage.setItem('drydock-icon-scale-v1', '1.25');
        const result = migrateFromLegacyKeys();
        expect(result.icons.scale).toBe(1.25);
      });

      it('should ignore invalid scale values', () => {
        localStorage.setItem('drydock-icon-scale-v1', '5.0');
        const result = migrateFromLegacyKeys();
        expect(result.icons.scale).toBe(DEFAULTS.icons.scale);
      });

      it('should ignore non-numeric scale values', () => {
        localStorage.setItem('drydock-icon-scale-v1', 'abc');
        const result = migrateFromLegacyKeys();
        expect(result.icons.scale).toBe(DEFAULTS.icons.scale);
      });
    });

    describe('appearance migration', () => {
      it('should migrate radius', () => {
        localStorage.setItem('drydock-radius-v1', 'round');
        const result = migrateFromLegacyKeys();
        expect(result.appearance.radius).toBe('round');
      });

      it('should ignore invalid radius values', () => {
        localStorage.setItem('drydock-radius-v1', 'invalid');
        const result = migrateFromLegacyKeys();
        expect(result.appearance.radius).toBe(DEFAULTS.appearance.radius);
      });
    });

    describe('layout migration', () => {
      it('should migrate sidebar collapsed true', () => {
        localStorage.setItem('dd-sidebar-v1', JSON.stringify(true));
        const result = migrateFromLegacyKeys();
        expect(result.layout.sidebarCollapsed).toBe(true);
      });

      it('should migrate sidebar collapsed false', () => {
        localStorage.setItem('dd-sidebar-v1', JSON.stringify(false));
        const result = migrateFromLegacyKeys();
        expect(result.layout.sidebarCollapsed).toBe(false);
      });

      it('should ignore non-boolean sidebar values', () => {
        localStorage.setItem('dd-sidebar-v1', '"stringvalue"');
        const result = migrateFromLegacyKeys();
        expect(result.layout.sidebarCollapsed).toBe(DEFAULTS.layout.sidebarCollapsed);
      });
    });

    describe('container migration', () => {
      it('should migrate table actions', () => {
        localStorage.setItem('dd-table-actions-v1', 'buttons');
        const result = migrateFromLegacyKeys();
        expect(result.containers.tableActions).toBe('buttons');
      });

      it('should ignore invalid table actions', () => {
        localStorage.setItem('dd-table-actions-v1', 'invalid');
        const result = migrateFromLegacyKeys();
        expect(result.containers.tableActions).toBe(DEFAULTS.containers.tableActions);
      });

      it('should migrate group by stack true', () => {
        localStorage.setItem('dd-group-by-stack-v1', 'true');
        const result = migrateFromLegacyKeys();
        expect(result.containers.groupByStack).toBe(true);
      });

      it('should migrate group by stack false', () => {
        localStorage.setItem('dd-group-by-stack-v1', 'false');
        const result = migrateFromLegacyKeys();
        expect(result.containers.groupByStack).toBe(false);
      });

      it('should migrate sort object', () => {
        localStorage.setItem(
          'dd-containers-sort-v1',
          JSON.stringify({ key: 'status', asc: false }),
        );
        const result = migrateFromLegacyKeys();
        expect(result.containers.sort.key).toBe('status');
        expect(result.containers.sort.asc).toBe(false);
      });

      it('should migrate filters', () => {
        localStorage.setItem(
          'dd-containers-filters-v1',
          JSON.stringify({
            status: 'running',
            registry: 'ghcr',
            bouncer: 'safe',
            server: 'local',
            kind: 'minor',
          }),
        );
        const result = migrateFromLegacyKeys();
        expect(result.containers.filters.status).toBe('running');
        expect(result.containers.filters.registry).toBe('ghcr');
        expect(result.containers.filters.bouncer).toBe('safe');
        expect(result.containers.filters.server).toBe('local');
        expect(result.containers.filters.kind).toBe('minor');
      });

      it('should keep only string-valued filter fields', () => {
        localStorage.setItem(
          'dd-containers-filters-v1',
          JSON.stringify({
            status: 'running',
            registry: 42,
            bouncer: null,
            server: false,
            kind: 'digest',
          }),
        );
        const result = migrateFromLegacyKeys();
        expect(result.containers.filters.status).toBe('running');
        expect(result.containers.filters.kind).toBe('digest');
      });

      it('should ignore filters payloads that contain no string values', () => {
        localStorage.setItem(
          'dd-containers-filters-v1',
          JSON.stringify({
            status: true,
            registry: 42,
          }),
        );
        const result = migrateFromLegacyKeys();
        expect(result.containers.filters).toEqual(DEFAULTS.containers.filters);
      });

      it('should migrate columns', () => {
        const columns = ['name', 'status', 'registry'];
        localStorage.setItem('dd-table-cols-v1', JSON.stringify(columns));
        const result = migrateFromLegacyKeys();
        expect(result.containers.columns).toEqual(['icon', ...columns]);
      });

      it('should drop stale columns that no longer exist in the table', () => {
        localStorage.setItem(
          'dd-table-cols-v1',
          JSON.stringify(['icon', 'name', 'bouncer', 'status', 'registry']),
        );
        const result = migrateFromLegacyKeys();
        expect(result.containers.columns).toEqual(['icon', 'name', 'status', 'registry']);
      });
    });

    describe('dashboard migration', () => {
      it('should migrate widget order', () => {
        const order = ['stat-updates', 'stat-containers', 'recent-updates'];
        localStorage.setItem('dd-dashboard-widget-order-v3', JSON.stringify(order));
        const result = migrateFromLegacyKeys();
        expect(result.dashboard.widgetOrder).toEqual(order);
      });
    });

    describe('security sort migration', () => {
      it('should migrate security sort field', () => {
        localStorage.setItem('dd-security-sort-field-v1', 'high');
        const result = migrateFromLegacyKeys();
        expect(result.views.security.sortField).toBe('high');
      });

      it('should migrate security sort ascending', () => {
        localStorage.setItem('dd-security-sort-asc-v1', JSON.stringify(true));
        const result = migrateFromLegacyKeys();
        expect(result.views.security.sortAsc).toBe(true);
      });

      it('should migrate security sort descending', () => {
        localStorage.setItem('dd-security-sort-asc-v1', JSON.stringify(false));
        const result = migrateFromLegacyKeys();
        expect(result.views.security.sortAsc).toBe(false);
      });
    });

    describe('agents sort migration', () => {
      it('should migrate agents sort key', () => {
        localStorage.setItem('dd-agents-sort-key-v1', 'status');
        const result = migrateFromLegacyKeys();
        expect(result.views.agents.sortKey).toBe('status');
      });

      it('should migrate agents sort ascending', () => {
        localStorage.setItem('dd-agents-sort-asc-v1', JSON.stringify(true));
        const result = migrateFromLegacyKeys();
        expect(result.views.agents.sortAsc).toBe(true);
      });

      it('should migrate agents sort descending', () => {
        localStorage.setItem('dd-agents-sort-asc-v1', JSON.stringify(false));
        const result = migrateFromLegacyKeys();
        expect(result.views.agents.sortAsc).toBe(false);
      });
    });

    describe('partial migration', () => {
      it('should handle only some legacy keys present', () => {
        localStorage.setItem('drydock-theme-family-v1', 'dracula');
        localStorage.setItem('dd-table-actions-v1', 'buttons');
        // All other keys absent
        const result = migrateFromLegacyKeys();
        expect(result.theme.family).toBe('dracula');
        expect(result.containers.tableActions).toBe('buttons');
        // Defaults for everything else
        expect(result.theme.variant).toBe('dark');
        expect(result.font.family).toBe('ibm-plex-mono');
        expect(result.icons.library).toBe('ph-duotone');
      });
    });

    describe('corrupt legacy values', () => {
      it('should handle corrupt JSON in sort key', () => {
        localStorage.setItem('dd-containers-sort-v1', '{bad-json');
        const result = migrateFromLegacyKeys();
        expect(result.containers.sort).toEqual(DEFAULTS.containers.sort);
      });

      it('should handle corrupt JSON in filters key', () => {
        localStorage.setItem('dd-containers-filters-v1', '{bad-json');
        const result = migrateFromLegacyKeys();
        expect(result.containers.filters).toEqual(DEFAULTS.containers.filters);
      });

      it('should handle corrupt JSON in columns key', () => {
        localStorage.setItem('dd-table-cols-v1', '{bad-json');
        const result = migrateFromLegacyKeys();
        expect(result.containers.columns).toEqual(DEFAULTS.containers.columns);
      });

      it('should handle corrupt JSON in widget order key', () => {
        localStorage.setItem('dd-dashboard-widget-order-v3', 'not-json');
        const result = migrateFromLegacyKeys();
        expect(result.dashboard.widgetOrder).toEqual(DEFAULTS.dashboard.widgetOrder);
      });

      it('should handle wrong type in sort key (not an object)', () => {
        localStorage.setItem('dd-containers-sort-v1', JSON.stringify('string'));
        const result = migrateFromLegacyKeys();
        expect(result.containers.sort).toEqual(DEFAULTS.containers.sort);
      });

      it('should handle wrong type in columns key (not an array)', () => {
        localStorage.setItem('dd-table-cols-v1', JSON.stringify({ key: 'val' }));
        const result = migrateFromLegacyKeys();
        expect(result.containers.columns).toEqual(DEFAULTS.containers.columns);
      });
    });

    describe('legacy key cleanup', () => {
      it('should defer deleting legacy keys until the idle callback runs', () => {
        for (const [index, key] of LEGACY_KEYS.entries()) {
          localStorage.setItem(key, `value-${index}`);
        }
        const callbacks: IdleRequestCallback[] = [];
        const original = globalThis.requestIdleCallback;
        globalThis.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
          callbacks.push(callback);
          return 1;
        });

        try {
          migrateFromLegacyKeys();

          expect(globalThis.requestIdleCallback).toHaveBeenCalledTimes(1);
          for (const [index, key] of LEGACY_KEYS.entries()) {
            expect(localStorage.getItem(key)).toBe(`value-${index}`);
          }

          callbacks[0]({
            didTimeout: false,
            timeRemaining: () => 50,
          } as IdleDeadline);

          for (const key of LEGACY_KEYS) {
            expect(localStorage.getItem(key)).toBeNull();
          }
        } finally {
          globalThis.requestIdleCallback = original;
        }
      });

      it('should write dd-preferences to localStorage', () => {
        localStorage.setItem('drydock-theme-family-v1', 'github');
        migrateFromLegacyKeys();
        const stored = localStorage.getItem('dd-preferences');
        expect(stored).not.toBeNull();
        const parsed = JSON.parse(stored ?? '{}');
        expect(parsed.theme.family).toBe('github');
      });

      it('should preserve legacy keys when setItem throws', () => {
        localStorage.setItem('drydock-theme-family-v1', 'github');
        localStorage.setItem('dd-containers-view-v1', 'cards');

        const originalSetItem = localStorage.setItem.bind(localStorage);
        const spy = vi
          .spyOn(localStorage, 'setItem')
          .mockImplementation((key: string, value: string) => {
            if (key === 'dd-preferences') throw new Error('QuotaExceededError');
            return originalSetItem(key, value);
          });

        migrateFromLegacyKeys();

        spy.mockRestore();

        // Legacy keys should still be there
        expect(localStorage.getItem('drydock-theme-family-v1')).toBe('github');
        expect(localStorage.getItem('dd-containers-view-v1')).toBe('cards');
      });
    });

    describe('idempotency', () => {
      it('should produce the same result when run twice', () => {
        localStorage.setItem('drydock-theme-family-v1', 'github');
        localStorage.setItem('dd-table-actions-v1', 'buttons');
        localStorage.setItem('dd-security-sort-field-v1', 'high');
        const first = migrateFromLegacyKeys();

        // Legacy keys were deleted. Running again with no legacy keys should give defaults.
        // But dd-preferences was written, so the store will load from there.
        // Reset to simulate a fresh run with the same legacy data:
        localStorage.clear();
        localStorage.setItem('drydock-theme-family-v1', 'github');
        localStorage.setItem('dd-table-actions-v1', 'buttons');
        localStorage.setItem('dd-security-sort-field-v1', 'high');
        const second = migrateFromLegacyKeys();

        expect(first).toEqual(second);
      });

      it('should be safe to run when no legacy keys exist', () => {
        const result = migrateFromLegacyKeys();
        expect(result).toEqual(DEFAULTS);
      });
    });
  });

  describe('v7 -> v8 migration', () => {
    it('should drop viewMode from containers and mode from views, preserving sort fields', () => {
      const result = migrate({
        schemaVersion: 7,
        containers: { viewMode: 'cards' },
        views: {
          security: { mode: 'list', sortField: 'name', sortAsc: true },
          audit: { mode: 'cards' },
        },
      });
      expect(result.schemaVersion).toBe(8);
      expect((result.containers as any).viewMode).toBeUndefined();
      expect((result.views.security as any).mode).toBeUndefined();
      expect(result.views.security.sortField).toBe('name');
      expect(result.views.security.sortAsc).toBe(true);
      expect(result.views.audit).toEqual({ hiddenColumns: [] });
    });

    it('should be idempotent: running migrate on a v8 result leaves schemaVersion 8 and no mode fields', () => {
      const first = migrate({
        schemaVersion: 7,
        containers: { viewMode: 'cards' },
        views: { security: { mode: 'list', sortField: 'name', sortAsc: true } },
      });
      expect(first.schemaVersion).toBe(8);
      const second = migrate(first as unknown as Record<string, unknown>);
      expect(second.schemaVersion).toBe(8);
      expect((second.containers as any).viewMode).toBeUndefined();
      expect((second.views.security as any).mode).toBeUndefined();
    });
  });

  describe('view hiddenColumns (security/watchers/servers/audit/agents)', () => {
    it('DEFAULTS should default hiddenColumns to an empty array for each view', () => {
      expect(DEFAULTS.views.security.hiddenColumns).toEqual([]);
      expect(DEFAULTS.views.watchers.hiddenColumns).toEqual([]);
      expect(DEFAULTS.views.servers.hiddenColumns).toEqual([]);
      expect(DEFAULTS.views.audit.hiddenColumns).toEqual([]);
      expect(DEFAULTS.views.agents.hiddenColumns).toEqual([]);
    });

    it('backfills hiddenColumns as [] for views missing the field in a legacy persisted blob', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          security: { sortField: 'critical', sortAsc: false },
          watchers: {},
          servers: {},
          audit: {},
          agents: { sortKey: 'name', sortAsc: true },
        },
      });
      expect(result.views.security.hiddenColumns).toEqual([]);
      expect(result.views.watchers.hiddenColumns).toEqual([]);
      expect(result.views.servers.hiddenColumns).toEqual([]);
      expect(result.views.audit.hiddenColumns).toEqual([]);
      expect(result.views.agents.hiddenColumns).toEqual([]);
    });

    it('backfills hiddenColumns as [] when the views object is entirely absent', () => {
      const result = migrate({ schemaVersion: DEFAULTS.schemaVersion });
      expect(result.views.security.hiddenColumns).toEqual([]);
      expect(result.views.watchers.hiddenColumns).toEqual([]);
      expect(result.views.servers.hiddenColumns).toEqual([]);
      expect(result.views.audit.hiddenColumns).toEqual([]);
      expect(result.views.agents.hiddenColumns).toEqual([]);
    });

    it('clamps non-array/non-string hiddenColumns garbage to an empty array for each view', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          security: { hiddenColumns: 'not-an-array' as any },
          watchers: { hiddenColumns: 42 as any },
          servers: { hiddenColumns: null as any },
          audit: { hiddenColumns: {} as any },
          agents: { hiddenColumns: false as any },
        },
      });
      expect(result.views.security.hiddenColumns).toEqual([]);
      expect(result.views.watchers.hiddenColumns).toEqual([]);
      expect(result.views.servers.hiddenColumns).toEqual([]);
      expect(result.views.audit.hiddenColumns).toEqual([]);
      expect(result.views.agents.hiddenColumns).toEqual([]);
    });

    it('drops unknown column keys from persisted hiddenColumns', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          security: { hiddenColumns: ['critical', 'bogus-key'] },
        },
      });
      expect(result.views.security.hiddenColumns).toEqual(['critical']);
    });

    it('drops required column keys from persisted hiddenColumns so a required column can never persist hidden', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          security: { hiddenColumns: ['image', 'critical'] },
          watchers: { hiddenColumns: ['name', 'status'] },
          servers: { hiddenColumns: ['name', 'host'] },
          audit: { hiddenColumns: ['containerName', 'action'] },
          agents: { hiddenColumns: ['name', 'status'] },
        },
      });
      expect(result.views.security.hiddenColumns).toEqual(['critical']);
      expect(result.views.watchers.hiddenColumns).toEqual(['status']);
      expect(result.views.servers.hiddenColumns).toEqual(['host']);
      expect(result.views.audit.hiddenColumns).toEqual(['action']);
      expect(result.views.agents.hiddenColumns).toEqual(['status']);
    });

    it('preserves valid hiddenColumns as-is', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          watchers: { hiddenColumns: ['cron', 'lastRun'] },
        },
      });
      expect(result.views.watchers.hiddenColumns).toEqual(['cron', 'lastRun']);
    });

    it('resets a non-record view to defaults during sanitization', () => {
      const result = migrate({
        schemaVersion: DEFAULTS.schemaVersion,
        views: {
          watchers: 'invalid' as any,
        },
      });
      expect(result.views.watchers).toEqual(DEFAULTS.views.watchers);
    });

    it('deletes a non-record view during sanitization of legacy schema data', () => {
      const result = migrate({
        schemaVersion: 1,
        views: {
          servers: 42 as any,
        },
      });
      expect(result.views.servers).toEqual(DEFAULTS.views.servers);
    });
  });
});
