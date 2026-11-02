import DashboardUpdateBreakdownWidget from '@/views/dashboard/components/DashboardUpdateBreakdownWidget.vue';
import type { UpdateBreakdownBucket } from '@/views/dashboard/dashboardTypes';
import { mountWithPlugins } from '../../helpers/mount';

function bucket(
  kind: UpdateBreakdownBucket['kind'],
  label: string,
  count = 0,
): UpdateBreakdownBucket {
  return {
    kind,
    label,
    color: 'var(--dd-primary)',
    colorMuted: 'var(--dd-primary-muted)',
    icon: 'hashtag',
    count,
  };
}

describe('DashboardUpdateBreakdownWidget', () => {
  it('explains the image update bucket and leaves the version buckets bare', () => {
    const wrapper = mountWithPlugins(DashboardUpdateBreakdownWidget, {
      props: {
        editMode: false,
        totalUpdates: 1,
        updateBreakdownBuckets: [bucket('major', 'Major', 1), bucket('digest', 'Image Update')],
      },
    });
    const cells = wrapper.findAll('.grid > div');
    expect(cells).toHaveLength(2);
    expect(cells[0].attributes('title')).toBeUndefined();
    expect(cells[1].attributes('title')).toBe('Same tag, new image digest');
    wrapper.unmount();
  });
});
