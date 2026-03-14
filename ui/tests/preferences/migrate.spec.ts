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
      const result = mergeDefaults({ containers: { viewMode: 'cards' } });
      expect(result.containers.viewMode).toBe('cards');
      expect(result.containers.tableActions).toBe('icons');
      expect(result.containers.groupByStack).toBe(false);
      expect(result.containers.sort).toEqual({ key: 'name', asc: true });
    });
  });

  describe('migrate', () => {
    it('should return merged defaults for schemaVersion 1 data', () => {
      const result = migrate({ schemaVersion: 1, theme: { family: 'dracula' } });
      expect(result.schemaVersion).toBe(1);
      expect(result.theme.family).toBe('dracula');
      expect(result.theme.variant).toBe('dark');
      expect(result.containers.viewMode).toBe('table');
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

    it('should preserve valid fontSize', () => {
      const result = migrate({ schemaVersion: 1, appearance: { fontSize: 1.1 } });
      expect(result.appearance.fontSize).toBe(1.1);
    });

    it('should replace invalid container viewMode with default', () => {
      const result = migrate({ schemaVersion: 1, containers: { viewMode: 'timeline' } });
      expect(result.containers.viewMode).toBe(DEFAULTS.containers.viewMode);
    });

    it('should replace invalid tableActions with default', () => {
      const result = migrate({ schemaVersion: 1, containers: { tableActions: 'links' } });
      expect(result.containers.tableActions).toBe(DEFAULTS.containers.tableActions);
    });

    it('should preserve all valid values through sanitization', () => {
      const input = {
        schemaVersion: 1,
        theme: { family: 'catppuccin', variant: 'light' },
        font: { family: 'jetbrains-mono' },
        icons: { library: 'tabler', scale: 1.2 },
        appearance: { radius: 'round', fontSize: 1.15 },
        containers: { viewMode: 'cards', tableActions: 'buttons' },
      };
      const result = migrate(input);
      expect(result.theme).toEqual({ family: 'catppuccin', variant: 'light' });
      expect(result.font.family).toBe('jetbrains-mono');
      expect(result.icons).toEqual({ library: 'tabler', scale: 1.2 });
      expect(result.appearance.radius).toBe('round');
      expect(result.appearance.fontSize).toBe(1.15);
      expect(result.containers.viewMode).toBe('cards');
      expect(result.containers.tableActions).toBe('buttons');
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
      it('should migrate container view mode', () => {
        localStorage.setItem('dd-containers-view-v1', 'cards');
        const result = migrateFromLegacyKeys();
        expect(result.containers.viewMode).toBe('cards');
      });

      it('should ignore invalid container view mode', () => {
        localStorage.setItem('dd-containers-view-v1', 'invalid');
        const result = migrateFromLegacyKeys();
        expect(result.containers.viewMode).toBe(DEFAULTS.containers.viewMode);
      });

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
        expect(result.containers.columns).toEqual(columns);
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

    describe('view mode migration', () => {
      it.each([
        ['security', 'dd-security-view-v1'],
        ['audit', 'dd-audit-view-v1'],
        ['agents', 'dd-agents-view-v1'],
        ['triggers', 'dd-triggers-view-v1'],
        ['watchers', 'dd-watchers-view-v1'],
        ['servers', 'dd-servers-view-v1'],
        ['registries', 'dd-registries-view-v1'],
        ['notifications', 'dd-notifications-view-v1'],
        ['auth', 'dd-auth-view-v1'],
      ] as const)('should migrate %s view mode', (viewName, legacyKey) => {
        localStorage.setItem(legacyKey, 'cards');
        const result = migrateFromLegacyKeys();
        expect(result.views[viewName].mode).toBe('cards');
      });

      it('should ignore invalid view modes for views', () => {
        localStorage.setItem('dd-triggers-view-v1', 'invalid');
        const result = migrateFromLegacyKeys();
        expect(result.views.triggers.mode).toBe(DEFAULTS.views.triggers.mode);
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

      it('should ignore security migration when only an invalid security view mode is present', () => {
        localStorage.setItem('dd-security-view-v1', 'invalid');
        const result = migrateFromLegacyKeys();
        expect(result.views.security).toEqual(DEFAULTS.views.security);
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

      it('should ignore agents migration when only an invalid agents view mode is present', () => {
        localStorage.setItem('dd-agents-view-v1', 'invalid');
        const result = migrateFromLegacyKeys();
        expect(result.views.agents).toEqual(DEFAULTS.views.agents);
      });
    });

    describe('partial migration', () => {
      it('should handle only some legacy keys present', () => {
        localStorage.setItem('drydock-theme-family-v1', 'dracula');
        localStorage.setItem('dd-containers-view-v1', 'list');
        // All other keys absent
        const result = migrateFromLegacyKeys();
        expect(result.theme.family).toBe('dracula');
        expect(result.containers.viewMode).toBe('list');
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
        localStorage.setItem('dd-containers-view-v1', 'list');
        localStorage.setItem('dd-audit-view-v1', 'cards');
        const first = migrateFromLegacyKeys();

        // Legacy keys were deleted. Running again with no legacy keys should give defaults.
        // But dd-preferences was written, so the store will load from there.
        // Reset to simulate a fresh run with the same legacy data:
        localStorage.clear();
        localStorage.setItem('drydock-theme-family-v1', 'github');
        localStorage.setItem('dd-containers-view-v1', 'list');
        localStorage.setItem('dd-audit-view-v1', 'cards');
        const second = migrateFromLegacyKeys();

        expect(first).toEqual(second);
      });

      it('should be safe to run when no legacy keys exist', () => {
        const result = migrateFromLegacyKeys();
        expect(result).toEqual(DEFAULTS);
      });
    });
  });
});
