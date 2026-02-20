import { mount } from '@vue/test-utils';
import ContainerTrigger from '@/components/ContainerTrigger';

const mockRunTrigger = vi.fn();
vi.mock('@/services/container', () => ({
  runTrigger: (...args: any[]) => mockRunTrigger(...args),
}));

const mockTrigger = {
  type: 'slack',
  name: 'my-slack-trigger',
  agent: false,
  configuration: { threshold: 'all' },
};

describe('ContainerTrigger', () => {
  let wrapper: any;

  beforeEach(() => {
    mockRunTrigger.mockReset();
    wrapper = mount(ContainerTrigger, {
      props: {
        trigger: mockTrigger,
        updateAvailable: true,
        containerId: 'container-1',
      },
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });
    wrapper.vm.$eventBus.emit.mockClear();
  });

  afterEach(() => {
    wrapper.unmount();
  });

  it('renders trigger type and name', () => {
    expect(wrapper.text()).toContain('slack');
    expect(wrapper.text()).toContain('my-slack-trigger');
  });

  it('renders threshold configuration', () => {
    expect(wrapper.text()).toContain('all');
  });

  it('receives updateAvailable as true', () => {
    expect(wrapper.props('updateAvailable')).toBe(true);
  });

  it('receives updateAvailable as false when no update', async () => {
    await wrapper.setProps({ updateAvailable: false });
    expect(wrapper.props('updateAvailable')).toBe(false);
  });

  it('calls runTrigger service on run', async () => {
    mockRunTrigger.mockResolvedValue(undefined);
    await wrapper.vm.runTrigger();
    expect(mockRunTrigger).toHaveBeenCalledWith({
      containerId: 'container-1',
      triggerType: 'slack',
      triggerName: 'my-slack-trigger',
      triggerAgent: false,
    });
  });

  it('emits notify on successful trigger run', async () => {
    mockRunTrigger.mockResolvedValue(undefined);
    await wrapper.vm.runTrigger();
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Trigger executed with success',
    );
  });

  it('emits error notify on failed trigger run', async () => {
    mockRunTrigger.mockRejectedValue(new Error('network error'));
    await wrapper.vm.runTrigger();
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Trigger executed with error (network error)',
      'error',
    );
  });

  it('sets isTriggering during execution', async () => {
    let resolvePromise: (() => void) | undefined;
    mockRunTrigger.mockReturnValue(
      new Promise<void>((r) => {
        resolvePromise = r;
      }),
    );
    const promise = wrapper.vm.runTrigger();
    expect(wrapper.vm.isTriggering).toBe(true);
    resolvePromise?.();
    await promise;
    expect(wrapper.vm.isTriggering).toBe(false);
  });
});
