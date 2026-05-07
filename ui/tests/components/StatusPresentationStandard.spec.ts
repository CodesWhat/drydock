import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(process.cwd(), 'src');

describe('status presentation standard', () => {
  it('uses AppStatusIndicator for dashboard status-heavy widgets', () => {
    const targetFiles = [
      join(SRC_DIR, 'views/dashboard/components/DashboardHostStatusWidget.vue'),
      join(SRC_DIR, 'views/dashboard/components/DashboardRecentUpdatesWidget.vue'),
      join(SRC_DIR, 'views/dashboard/components/DashboardSecurityOverviewWidget.vue'),
    ];
    const offenders: string[] = [];

    for (const filePath of targetFiles) {
      const source = readFileSync(filePath, 'utf8');
      if (!/<AppStatusIndicator\b/.test(source) || /<AppBadge\b/.test(source)) {
        offenders.push(relative(process.cwd(), filePath).replaceAll('\\', '/'));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('does not hand-roll security runtime status badges', () => {
    const source = readFileSync(join(SRC_DIR, 'views/SecurityView.vue'), 'utf8');

    expect(source).toContain('<AppStatusIndicator');
    expect(source).not.toContain('statusBadgeTone');
    expect(source).not.toMatch(/runtimeStatus[\s\S]{0,240}<AppBadge\b/);
  });
});
