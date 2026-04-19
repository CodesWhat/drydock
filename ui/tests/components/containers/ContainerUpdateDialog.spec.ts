import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const mockUpdateContainer = vi.fn();
const mockGetContainerUpdateStartedMessage = vi.fn().mockReturnValue('Update started');

vi.mock('@/services/container-actions', () => ({
  updateContainer: (...args: any[]) => mockUpdateContainer(...args),
}));

vi.mock('@/utils/container-update', () => ({
  getContainerUpdateStartedMessage: (...args: any[]) =>
    mockGetContainerUpdateStartedMessage(...args),
}));

import ContainerUpdateDialog from '@/components/containers/ContainerUpdateDialog.vue';

function factory(props: Record<string, any> = {}) {
  return mount(ContainerUpdateDialog, {
    attachTo: document.body,
    props: {
      containerId: null,
      ...props,
    },
  });
}

describe('ContainerUpdateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('open / close via prop', () => {
    it('is not rendered when containerId is null', () => {
      const w = factory({ containerId: null });
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
      w.unmount();
    });

    it('renders the dialog when containerId is set', async () => {
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
      w.unmount();
    });

    it('emits update:containerId null when Cancel is clicked', async () => {
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const cancelBtn = [...document.body.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Cancel'),
      );
      expect(cancelBtn).toBeTruthy();
      cancelBtn!.click();
      await nextTick();
      expect(w.emitted('update:containerId')).toEqual([[null]]);
      w.unmount();
    });
  });

  describe('confirm message', () => {
    it('shows tag change message when currentTag and newTag are provided', async () => {
      const w = factory({
        containerId: 'abc123',
        containerName: 'my-nginx',
        currentTag: '1.25',
        newTag: '1.26',
        updateKind: 'patch',
      });
      await nextTick();
      const desc = document.getElementById('container-update-dialog-desc');
      expect(desc?.textContent).toContain('1.25');
      expect(desc?.textContent).toContain('1.26');
      expect(desc?.textContent).toContain('patch');
      w.unmount();
    });

    it('shows digest change message when updateKind is digest', async () => {
      const w = factory({
        containerId: 'abc123',
        containerName: 'my-nginx',
        currentTag: '1.25',
        newTag: '1.25',
        updateKind: 'digest',
      });
      await nextTick();
      const desc = document.getElementById('container-update-dialog-desc');
      expect(desc?.textContent).toContain('digest change');
      w.unmount();
    });

    it('shows generic message when no tags are provided', async () => {
      const w = factory({ containerId: 'abc123', containerName: 'my-nginx' });
      await nextTick();
      const desc = document.getElementById('container-update-dialog-desc');
      expect(desc?.textContent).toContain('my-nginx');
      expect(desc?.textContent).toContain('latest discovered image');
      w.unmount();
    });

    it('falls back to containerId in message when containerName is not provided', async () => {
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const desc = document.getElementById('container-update-dialog-desc');
      expect(desc?.textContent).toContain('abc123');
      w.unmount();
    });
  });

  describe('confirm action', () => {
    it('calls updateContainer with the containerId on confirm', async () => {
      mockUpdateContainer.mockResolvedValue(undefined);
      const w = factory({ containerId: 'abc123', containerName: 'my-nginx' });
      await nextTick();
      const updateBtn = [...document.body.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Update',
      );
      expect(updateBtn).toBeTruthy();
      updateBtn!.click();
      await flushPromises();
      expect(mockUpdateContainer).toHaveBeenCalledWith('abc123');
      w.unmount();
    });

    it('emits updated and closes after successful update', async () => {
      mockUpdateContainer.mockResolvedValue(undefined);
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const updateBtn = [...document.body.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Update',
      );
      updateBtn!.click();
      await flushPromises();
      expect(w.emitted('updated')).toEqual([['abc123']]);
      expect(w.emitted('update:containerId')).toEqual([[null]]);
      w.unmount();
    });

    it('shows error and keeps dialog open when update fails', async () => {
      mockUpdateContainer.mockRejectedValue(new Error('Network error'));
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const updateBtn = [...document.body.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Update',
      );
      updateBtn!.click();
      await flushPromises();
      expect(w.emitted('updated')).toBeUndefined();
      expect(w.emitted('update:containerId')).toBeUndefined();
      expect(document.body.textContent).toContain('Network error');
      w.unmount();
    });

    it('does not call updateContainer when already in progress', async () => {
      let resolveUpdate!: () => void;
      mockUpdateContainer.mockReturnValue(
        new Promise<void>((r) => {
          resolveUpdate = r;
        }),
      );
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const updateBtn = [...document.body.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Update'),
      );
      updateBtn!.click();
      await nextTick();
      updateBtn!.click();
      resolveUpdate();
      await flushPromises();
      expect(mockUpdateContainer).toHaveBeenCalledTimes(1);
      w.unmount();
    });

    it('clears error when containerId prop changes', async () => {
      mockUpdateContainer.mockRejectedValue(new Error('Fail'));
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const updateBtn = [...document.body.querySelectorAll('button')].find(
        (b) => b.textContent?.trim() === 'Update',
      );
      updateBtn!.click();
      await flushPromises();
      expect(document.body.textContent).toContain('Fail');

      await w.setProps({ containerId: 'other-id' });
      await nextTick();
      expect(document.body.textContent).not.toContain('Fail');
      w.unmount();
    });
  });

  describe('keyboard handling', () => {
    it('closes dialog on Escape key', async () => {
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const overlay = document.body.querySelector('.fixed') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      overlay!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: false }));
      await nextTick();
      expect(w.emitted('update:containerId')).toEqual([[null]]);
      w.unmount();
    });

    it('confirms dialog on Enter key', async () => {
      mockUpdateContainer.mockResolvedValue(undefined);
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const overlay = document.body.querySelector('.fixed') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      overlay!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: false }));
      await flushPromises();
      expect(mockUpdateContainer).toHaveBeenCalledWith('abc123');
      w.unmount();
    });

    it('does not confirm on Enter with modifier keys', async () => {
      mockUpdateContainer.mockResolvedValue(undefined);
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const overlay = document.body.querySelector('.fixed') as HTMLElement | null;
      expect(overlay).toBeTruthy();
      overlay!.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: false }),
      );
      await flushPromises();
      expect(mockUpdateContainer).not.toHaveBeenCalled();
      w.unmount();
    });

    it('does not handle keyboard events when dialog is closed', async () => {
      const w = factory({ containerId: null });
      await nextTick();
      // No overlay rendered when dialog is closed
      expect(document.body.querySelector('.fixed')).toBeNull();
      expect(w.emitted('update:containerId')).toBeUndefined();
      w.unmount();
    });
  });

  describe('dialog semantics', () => {
    it('has correct ARIA attributes', async () => {
      const w = factory({ containerId: 'abc123' });
      await nextTick();
      const dialog = document.body.querySelector('[role="dialog"]') as HTMLElement | null;
      expect(dialog?.getAttribute('aria-modal')).toBe('true');
      expect(dialog?.getAttribute('aria-labelledby')).toBe('container-update-dialog-title');
      expect(dialog?.getAttribute('aria-describedby')).toBe('container-update-dialog-desc');
      expect(document.getElementById('container-update-dialog-title')?.textContent).toContain(
        'Update Container',
      );
      w.unmount();
    });
  });
});
