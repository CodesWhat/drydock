import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import AppToast from '@/components/AppToast.vue';
import { useToast } from '@/composables/useToast';
import { useToastStore } from '@/stores/toast';
import { mountWithPlugins } from '../helpers/mount';

describe('AppToast queue', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.useFakeTimers();
  });

  afterEach(() => {
    useToastStore().clear();
    vi.useRealTimers();
  });

  it('renders three notifications and reveals overflow through the real dismiss button', async () => {
    const toast = useToast();
    const wrapper = mountWithPlugins(AppToast, {
      global: { plugins: [pinia], stubs: { Teleport: true } },
    });
    onTestFinished(() => wrapper.unmount());
    toast.success('first', 'success body');
    toast.error('second', 'error body');
    toast.warning('third', 'warning body');
    const queued = toast.info('fourth', 'info body');
    toast.addToast('fifth', { duration: 0 });
    await nextTick();

    expect(wrapper.findAll('button')).toHaveLength(3);
    expect(wrapper.text()).toContain('success body');
    expect(wrapper.text()).toContain('error body');
    expect(wrapper.text()).toContain('warning body');
    expect(wrapper.text()).not.toContain('fourth');
    expect(wrapper.text()).not.toContain('fifth');
    await wrapper.find('button').trigger('click');
    expect(wrapper.findAll('button')).toHaveLength(3);
    expect(wrapper.text()).not.toContain('first');
    expect(wrapper.text()).toContain('fourth');
    expect(wrapper.text()).toContain('info body');
    expect(toast.toasts.value[2]).toMatchObject({ id: queued, tone: 'info' });
    expect(wrapper.text()).not.toContain('fifth');

    await vi.advanceTimersByTimeAsync(6000);
    expect(wrapper.findAll('button')).toHaveLength(1);
    expect(wrapper.text()).toContain('fifth');
    await wrapper.find('button').trigger('click');
    expect(wrapper.findAll('button')).toHaveLength(0);
  });
});
