import { flushPromises, mount } from '@vue/test-utils';
import ContainerLogs from '@/components/ContainerLogs';

const { mockGetContainerLogs } = vi.hoisted(() => ({
  mockGetContainerLogs: vi.fn(),
}));

vi.mock('@/services/container', () => ({
  getContainerLogs: mockGetContainerLogs,
}));

const mockContainer = {
  id: 'test-container-id',
  name: 'test-container',
};

describe('ContainerLogs', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockGetContainerLogs.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows loading state initially', async () => {
    mockGetContainerLogs.mockReturnValue(new Promise(() => {}));

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await wrapper.vm.$nextTick();

    expect(wrapper.find('.v-progress-circular').exists()).toBe(true);
    wrapper.unmount();
  });

  it('displays logs after successful fetch', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'hello world\nsecond line' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(wrapper.find('pre').exists()).toBe(true);
    expect(wrapper.find('pre').text()).toContain('hello world');
    expect(wrapper.find('pre').text()).toContain('second line');
    wrapper.unmount();
  });

  it('shows error state on fetch failure', async () => {
    mockGetContainerLogs.mockRejectedValue(new Error('Network error'));

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(wrapper.find('.v-alert').exists()).toBe(true);
    expect(wrapper.text()).toContain('Network error');
    wrapper.unmount();
  });

  it('stringifies non-Error failures in error state', async () => {
    mockGetContainerLogs.mockRejectedValue('raw-error');

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(wrapper.text()).toContain('raw-error');
    wrapper.unmount();
  });

  it('shows empty state when no logs returned', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: '' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(wrapper.find('pre').exists()).toBe(false);
    expect(wrapper.text()).toContain('No logs available');
    wrapper.unmount();
  });

  it('treats non-string logs payload as empty', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 12345 });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(wrapper.vm.logs).toBe('');
    wrapper.unmount();
  });

  it('refresh button triggers re-fetch', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'initial logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();
    expect(mockGetContainerLogs).toHaveBeenCalledTimes(1);

    mockGetContainerLogs.mockResolvedValue({ logs: 'refreshed logs' });
    await wrapper.find('.v-btn').trigger('click');
    await flushPromises();

    expect(mockGetContainerLogs).toHaveBeenCalledTimes(2);
    expect(wrapper.find('pre').text()).toContain('refreshed logs');
    wrapper.unmount();
  });

  it('changing tail count triggers re-fetch', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();
    expect(mockGetContainerLogs).toHaveBeenCalledWith('test-container-id', 100);

    mockGetContainerLogs.mockResolvedValue({ logs: 'more logs' });
    wrapper.vm.tail = 500;
    await flushPromises();

    expect(mockGetContainerLogs).toHaveBeenCalledWith('test-container-id', 500);
    wrapper.unmount();
  });

  it('updates tail through v-select model handler', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
      global: {
        stubs: {
          'v-select': {
            template:
              '<div class="v-select-stub" @click="$emit(\'update:modelValue\', 500)"></div>',
            emits: ['update:modelValue'],
          },
        },
      },
    });

    await flushPromises();
    await wrapper.find('.v-select-stub').trigger('click');
    await flushPromises();

    expect(wrapper.vm.tail).toBe(500);
    wrapper.unmount();
  });

  it('passes container id and default tail to service', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: '' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(mockGetContainerLogs).toHaveBeenCalledWith('test-container-id', 100);
    wrapper.unmount();
  });

  it('re-fetches and clears scroll lock when container id changes', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'initial logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();
    expect(mockGetContainerLogs).toHaveBeenCalledTimes(1);

    wrapper.vm.scrollBlocked = true;
    mockGetContainerLogs.mockResolvedValue({ logs: 'new container logs' });
    await wrapper.setProps({
      container: {
        ...mockContainer,
        id: 'different-container-id',
      },
    });
    await flushPromises();

    expect(wrapper.vm.scrollBlocked).toBe(false);
    expect(mockGetContainerLogs).toHaveBeenLastCalledWith('different-container-id', 100);
    wrapper.unmount();
  });

  it('auto-fetches logs on interval', async () => {
    vi.useFakeTimers();
    mockGetContainerLogs.mockResolvedValue({ logs: 'logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();
    expect(mockGetContainerLogs).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    await flushPromises();

    expect(mockGetContainerLogs).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });

  it('stops auto-fetching when interval is disabled', async () => {
    vi.useFakeTimers();
    mockGetContainerLogs.mockResolvedValue({ logs: 'logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();
    expect(mockGetContainerLogs).toHaveBeenCalledTimes(1);

    wrapper.vm.autoFetchSeconds = 0;
    await wrapper.vm.$nextTick();

    await vi.advanceTimersByTimeAsync(10000);
    await flushPromises();

    expect(mockGetContainerLogs).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('locks and unlocks auto-scroll based on scroll position', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'line 1\nline 2\nline 3' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    const pre = wrapper.find('pre');
    expect(pre.exists()).toBe(true);

    Object.defineProperty(pre.element, 'scrollHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(pre.element, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    pre.element.scrollTop = 150;
    await pre.trigger('scroll');
    expect(wrapper.vm.scrollBlocked).toBe(true);

    pre.element.scrollTop = 300;
    await pre.trigger('scroll');
    expect(wrapper.vm.scrollBlocked).toBe(false);
    wrapper.unmount();
  });

  it('resume button clears scroll lock and jumps to bottom', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'line 1\nline 2\nline 3' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    const pre = wrapper.find('pre');
    expect(pre.exists()).toBe(true);

    Object.defineProperty(pre.element, 'scrollHeight', {
      configurable: true,
      value: 400,
    });
    Object.defineProperty(pre.element, 'clientHeight', {
      configurable: true,
      value: 100,
    });

    pre.element.scrollTop = 150;
    wrapper.vm.scrollBlocked = true;
    await wrapper.vm.$nextTick();

    const resumeButton = wrapper
      .findAll('.v-btn')
      .find((button) => button.text().includes('Resume'));
    expect(resumeButton).toBeDefined();
    await resumeButton?.trigger('click');

    expect(wrapper.vm.scrollBlocked).toBe(false);
    expect(pre.element.scrollTop).toBe(400);
    wrapper.unmount();
  });

  it('fetches without auto-scroll when scroll is blocked', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: 'initial logs' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();
    wrapper.vm.scrollBlocked = true;

    mockGetContainerLogs.mockResolvedValue({ logs: 'updated logs' });
    await wrapper.vm.fetchLogs();
    await flushPromises();

    expect(wrapper.vm.logs).toBe('updated logs');
    expect(wrapper.vm.scrollBlocked).toBe(true);
    wrapper.unmount();
  });
});
