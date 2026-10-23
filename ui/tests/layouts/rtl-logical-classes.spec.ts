import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (file: string) => readFileSync(resolve(__dirname, '../../src', file), 'utf8');

describe('RTL logical utilities in the app shell', () => {
  const shell = [
    'layouts/AppLayout.vue',
    'components/AppTabBar.vue',
    'components/NotificationBell.vue',
  ];
  const physical =
    /(?:^|[\s"'])(?:ml|mr|pl|pr)-[\w[\].]+|(?:^|[\s"'])text-(?:left|right)(?=[\s"'])/m;

  it.each(shell)('%s uses logical spacing and alignment classes', (file) => {
    const template = read(file).split('<style')[0];
    expect(template).not.toMatch(physical);
  });

  it('flips the sidebar slide-in and navigation chevron under rtl', () => {
    const layout = read('layouts/AppLayout.vue');
    expect(layout).toContain('rtl:translate-x-full');
    expect(layout).toContain('rtl:-scale-x-100');
    expect(layout).toContain('start-0');
  });

  it('aligns table actions with text-end', () => {
    expect(read('components/DataTable.vue')).not.toMatch(/['\s]text-right['\s]/);
  });
});
