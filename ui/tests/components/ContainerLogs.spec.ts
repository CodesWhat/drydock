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
    mockGetContainerLogs.mockReset();
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

  it('passes container id and default tail to service', async () => {
    mockGetContainerLogs.mockResolvedValue({ logs: '' });

    const wrapper = mount(ContainerLogs, {
      props: { container: mockContainer },
    });

    await flushPromises();

    expect(mockGetContainerLogs).toHaveBeenCalledWith('test-container-id', 100);
    wrapper.unmount();
  });
});
