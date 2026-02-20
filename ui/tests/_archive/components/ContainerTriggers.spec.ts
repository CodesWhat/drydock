import { flushPromises, mount } from '@vue/test-utils';
import ContainerTriggers from '@/components/ContainerTriggers';

const mockGetContainerTriggers = vi.fn();
vi.mock('@/services/container', () => ({
  getContainerTriggers: (...args: any[]) => mockGetContainerTriggers(...args),
}));

const mockContainer = {
  id: 'container-1',
  updateAvailable: true,
};

const mockTriggers = [
  { id: 'trigger-1', type: 'slack', name: 'slack-notif', configuration: { threshold: 'all' } },
  { id: 'trigger-2', type: 'smtp', name: 'email-notif', configuration: { threshold: 'major' } },
];

describe('ContainerTriggers', () => {
  let wrapper: any;

  afterEach(() => {
    if (wrapper) wrapper.unmount();
  });

  it('fetches triggers on created', async () => {
    mockGetContainerTriggers.mockResolvedValue(mockTriggers);
    wrapper = mount(ContainerTriggers, {
      props: { container: mockContainer },
    });
    await flushPromises();
    expect(mockGetContainerTriggers).toHaveBeenCalledWith('container-1');
  });

  it('renders trigger components when triggers exist', async () => {
    mockGetContainerTriggers.mockResolvedValue(mockTriggers);
    wrapper = mount(ContainerTriggers, {
      props: { container: mockContainer },
      global: {
        stubs: {
          'container-trigger': {
            template: '<div class="container-trigger-stub"></div>',
            props: ['trigger', 'updateAvailable', 'containerId'],
          },
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });
    await flushPromises();
    const triggers = wrapper.findAll('.container-trigger-stub');
    expect(triggers.length).toBe(2);
  });

  it('renders no-triggers message when empty', async () => {
    mockGetContainerTriggers.mockResolvedValue([]);
    wrapper = mount(ContainerTriggers, {
      props: { container: mockContainer },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('No triggers associated to the container');
  });
});
