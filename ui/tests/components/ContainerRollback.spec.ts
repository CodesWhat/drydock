import { mount } from '@vue/test-utils';
import ContainerRollback from '@/components/ContainerRollback';

vi.mock('@/services/backup', () => ({
  getBackups: vi.fn(),
  rollback: vi.fn(),
}));

import { getBackups, rollback } from '@/services/backup';

const mockBackups = [
  {
    id: 'backup-1',
    containerId: 'test-container-id',
    containerName: 'test-container',
    imageName: 'nginx',
    imageTag: '1.0.0',
    timestamp: '2025-01-15T10:00:00Z',
    triggerName: 'docker-local',
  },
  {
    id: 'backup-2',
    containerId: 'test-container-id',
    containerName: 'test-container',
    imageName: 'nginx',
    imageTag: '0.9.0',
    timestamp: '2025-01-10T08:00:00Z',
    triggerName: 'docker-local',
  },
];

describe('ContainerRollback', () => {
  let wrapper;

  function createWrapper(props = {}) {
    return mount(ContainerRollback, {
      props: {
        containerId: 'test-container-id',
        containerName: 'test-container',
        modelValue: false,
        ...props,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('does not fetch backups when dialog is closed', () => {
    wrapper = createWrapper({ modelValue: false });
    expect(getBackups).not.toHaveBeenCalled();
  });

  it('fetches backups when dialog opens', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await wrapper.vm.$nextTick();

    expect(getBackups).toHaveBeenCalledWith('test-container-id');
  });

  it('stores backup data on success', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.backups).toEqual(mockBackups);
    expect(wrapper.vm.loading).toBe(false);
    expect(wrapper.vm.error).toBe('');
  });

  it('sets error on fetch failure', async () => {
    (getBackups as any).mockRejectedValue(new Error('Network error'));
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.error).toBe('Network error');
    expect(wrapper.vm.backups).toEqual([]);
  });

  it('uses default fetch error when rejection is not an Error', async () => {
    (getBackups as any).mockRejectedValue({});
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.error).toBe('Failed to load backups');
    expect(wrapper.vm.loading).toBe(false);
  });

  it('allows selecting a backup', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.selectBackup('backup-2');
    expect(wrapper.vm.selectedBackupId).toBe('backup-2');
  });

  it('calls rollback service on confirmRollback', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    (rollback as any).mockResolvedValue({ message: 'success' });
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.selectBackup('backup-1');
    await wrapper.vm.confirmRollback();

    expect(rollback).toHaveBeenCalledWith('test-container-id', 'backup-1');
  });

  it('emits rollback-success on successful rollback', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    (rollback as any).mockResolvedValue({ message: 'success' });
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.selectBackup('backup-1');
    await wrapper.vm.confirmRollback();

    expect(wrapper.emitted('rollback-success')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
  });

  it('sets error on rollback failure', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    (rollback as any).mockRejectedValue(new Error('Rollback failed'));
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.selectBackup('backup-1');
    await wrapper.vm.confirmRollback();

    expect(wrapper.vm.error).toBe('Rollback failed');
    expect(wrapper.emitted('rollback-error')).toBeTruthy();
  });

  it('uses default rollback error when rejection is not an Error', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    (rollback as any).mockRejectedValue({});
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    wrapper.vm.selectBackup('backup-1');
    await wrapper.vm.confirmRollback();

    expect(wrapper.vm.error).toBe('Rollback failed');
    expect(wrapper.emitted('rollback-error')?.[0]).toEqual(['Rollback failed']);
    expect(wrapper.vm.rolling).toBe(false);
  });

  it('does not call rollback without a selected backup', async () => {
    wrapper = createWrapper({ modelValue: true });
    await wrapper.vm.confirmRollback();
    expect(rollback).not.toHaveBeenCalled();
  });

  it('emits update:modelValue false when close is called', () => {
    wrapper = createWrapper({ modelValue: true });
    wrapper.vm.close();
    expect(wrapper.emitted('update:modelValue')).toBeTruthy();
    expect(wrapper.emitted('update:modelValue')[0]).toEqual([false]);
  });

  it('resets state when dialog closes', async () => {
    (getBackups as any).mockResolvedValue(mockBackups);
    wrapper = createWrapper({ modelValue: false });

    await wrapper.setProps({ modelValue: true });
    await new Promise((r) => setTimeout(r, 10));

    expect(wrapper.vm.backups).toEqual(mockBackups);

    await wrapper.setProps({ modelValue: false });
    expect(wrapper.vm.backups).toEqual([]);
    expect(wrapper.vm.error).toBe('');
    expect(wrapper.vm.selectedBackupId).toBe('');
  });
});
