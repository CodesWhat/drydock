import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import { i18n } from '@/boot/i18n';
import FleetUpdateProgressBanner from '@/components/containers/FleetUpdateProgressBanner.vue';
import { useOperationStore } from '@/stores/operations';

describe('FleetUpdateProgressBanner', () => {
  const originalLocale = i18n.global.locale.value;
  let wrapper: ReturnType<typeof mount> | undefined;
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    i18n.global.locale.value = 'en';
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    i18n.global.locale.value = originalLocale;
    setActivePinia(undefined);
  });

  it('switches live progress to French and preserves counts, name limits and completion', async () => {
    const operations = useOperationStore();
    const names = ['api', 'db', 'cache', 'worker', 'proxy', 'done', 'failed'];
    names.forEach((name, index) => {
      operations.applyOperationChanged({
        operationId: name,
        containerId: name,
        containerName: name,
        batchId: 'fleet',
        status: index < 5 ? 'in-progress' : index === 5 ? 'succeeded' : 'failed',
      });
    });
    wrapper = mount(FleetUpdateProgressBanner, { global: { plugins: [pinia] } });
    expect(wrapper.text()).toContain('Updating 2 of 7 containers');
    expect(wrapper.text()).toContain('Running now: api, db, cache +2 more');

    i18n.global.locale.value = 'fr';
    await nextTick();
    expect(wrapper.text()).toContain('Mise à jour : 2 conteneurs sur 7');
    expect(wrapper.text()).toContain('En cours : api, db, cache et 2 de plus');
    expect(wrapper.text()).not.toContain('worker');
    expect(wrapper.text()).not.toContain('proxy');

    for (const name of ['worker', 'proxy']) {
      operations.applyUpdateApplied({
        operationId: name,
        containerId: name,
        containerName: name,
        batchId: 'fleet',
        timestamp: '2026-09-16T16:00:00.000Z',
      });
    }
    await nextTick();
    expect(wrapper.text()).toContain('Mise à jour : 4 conteneurs sur 7');
    expect(wrapper.text()).toContain('En cours : api, db, cache');
    expect(wrapper.text()).not.toContain('de plus');

    for (const name of ['api', 'db', 'cache']) {
      operations.applyUpdateApplied({
        operationId: name,
        containerId: name,
        containerName: name,
        batchId: 'fleet',
        timestamp: '2026-09-16T16:00:01.000Z',
      });
    }
    await nextTick();
    expect(wrapper.find('[data-test="fleet-update-progress"]').exists()).toBe(false);
  });

  it('renders queued batches without a running-name line and ignores single-container updates', () => {
    const operations = useOperationStore();
    for (const name of ['api', 'db']) {
      operations.applyOperationChanged({
        operationId: name,
        containerName: name,
        batchId: 'queued-fleet',
        status: 'queued',
      });
    }
    operations.applyOperationChanged({
      operationId: 'single',
      containerName: 'single',
      batchId: 'single-batch',
      status: 'in-progress',
    });
    i18n.global.locale.value = 'fr';
    wrapper = mount(FleetUpdateProgressBanner, { global: { plugins: [pinia] } });
    expect(wrapper.findAll('[data-test="fleet-update-progress"]')).toHaveLength(1);
    expect(wrapper.text()).toBe('Mise à jour : 0 conteneurs sur 2');
  });
});
