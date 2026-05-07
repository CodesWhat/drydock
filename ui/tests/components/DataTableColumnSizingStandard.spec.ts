import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const DATA_TABLE_CALLERS = [
  'src/components/config/ConfigGeneralTab.vue',
  'src/views/NotificationOutboxView.vue',
  'src/views/WatchersView.vue',
  'src/views/AgentsView.vue',
  'src/views/NotificationsView.vue',
  'src/views/ContainersView.vue',
  'src/views/RegistriesView.vue',
  'src/views/AuditView.vue',
  'src/views/SecurityView.vue',
  'src/views/AuthView.vue',
  'src/views/TriggersView.vue',
  'src/views/ServersView.vue',
  'src/views/dashboard/components/DashboardRecentUpdatesWidget.vue',
];

function listVueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = resolve(dir, entry);
    if (statSync(path).isDirectory()) {
      return listVueFiles(path);
    }
    return path.endsWith('.vue') ? [path] : [];
  });
}

describe('DataTable first-party column sizing standard', () => {
  it('does not define string or percentage widths in first-party DataTable columns', () => {
    const offenders = DATA_TABLE_CALLERS.flatMap((file) => {
      const source = readFileSync(resolve(file), 'utf8');
      return [...source.matchAll(/\bwidth:\s*['"`][^'"`]+['"`]/g)].map((match) => ({
        file,
        text: match[0],
      }));
    });

    expect(offenders).toEqual([]);
  });

  it('keeps first-party table markup behind the shared DataTable component', () => {
    const offenders = listVueFiles(resolve('src'))
      .filter((file) => !file.endsWith(resolve('src/components/DataTable.vue')))
      .flatMap((file) => {
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(/<table\b/g)].map((match) => ({
          file,
          text: match[0],
        }));
      });

    expect(offenders).toEqual([]);
  });
});
