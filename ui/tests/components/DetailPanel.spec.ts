import { mount } from '@vue/test-utils';
import DetailPanel from '@/components/DetailPanel.vue';

const mountedWrappers: Array<ReturnType<typeof mount>> = [];

function factory(props: Record<string, any> = {}, slots: Record<string, any> = {}) {
  const wrapper = mount(DetailPanel, {
    props: { open: true, isMobile: false, ...props },
    slots,
    global: {
      stubs: { AppIcon: { template: '<span class="app-icon-stub" />', props: ['name', 'size'] } },
    },
  });
  mountedWrappers.push(wrapper);
  return wrapper;
}

describe('DetailPanel', () => {
  afterEach(() => {
    while (mountedWrappers.length) {
      mountedWrappers.pop()?.unmount();
    }
  });

  describe('visibility', () => {
    it('renders panel when open is true', () => {
      const w = factory({ open: true });
      expect(w.find('aside').exists()).toBe(true);
    });

    it('does not render panel when open is false', () => {
      const w = factory({ open: false });
      expect(w.find('aside').exists()).toBe(false);
    });
  });

  describe('mobile overlay', () => {
    it('shows overlay backdrop when open and mobile', () => {
      const w = factory({ open: true, isMobile: true });
      const overlay = w.find('.fixed.inset-0');
      expect(overlay.exists()).toBe(true);
    });

    it('does not show overlay when not mobile', () => {
      const w = factory({ open: true, isMobile: false });
      expect(w.find('.fixed.inset-0.bg-black\\/50').exists()).toBe(false);
    });

    it('emits update:open false when overlay is clicked', async () => {
      const w = factory({ open: true, isMobile: true });
      await w.find('.fixed.inset-0').trigger('click');
      expect(w.emitted('update:open')?.[0]).toEqual([false]);
    });

    it('uses fixed positioning on mobile', () => {
      const w = factory({ open: true, isMobile: true });
      expect(w.find('aside').classes()).toContain('fixed');
    });

    it('uses sticky positioning on desktop', () => {
      const w = factory({ open: true, isMobile: false });
      expect(w.find('aside').classes()).toContain('sticky');
    });
  });

  describe('close button', () => {
    it('emits update:open false when close button is clicked', async () => {
      const w = factory();
      // Close button is the w-7 h-7 button in the toolbar (last button in the toolbar row)
      const toolbarButtons = w
        .findAll('button')
        .filter((b) => b.classes().includes('w-7') && b.classes().includes('h-7'));
      // The close button is the one that is not a size control (S/M/L)
      const closeBtn = toolbarButtons.find((b) => !['S', 'M', 'L'].includes(b.text().trim()));
      expect(closeBtn).toBeDefined();
      await closeBtn?.trigger('click');
      expect(w.emitted('update:open')?.[0]).toEqual([false]);
    });

    it('emits update:open false when Escape is pressed while open', async () => {
      const w = factory({ open: true });
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(w.emitted('update:open')?.[0]).toEqual([false]);
    });

    it('does not emit close on Escape when panel is already closed', async () => {
      const w = factory({ open: false });
      globalThis.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(w.emitted('update:open')).toBeUndefined();
    });
  });

  describe('accessibility', () => {
    it('renders desktop panel with dialog role', () => {
      const w = factory({ open: true, isMobile: false });
      const panel = w.find('aside');
      expect(panel.attributes('role')).toBe('dialog');
      expect(panel.attributes('aria-modal')).toBeUndefined();
      expect(panel.attributes('aria-label')).toBeTruthy();
    });

    it('renders mobile panel with aria-modal=true', () => {
      const w = factory({ open: true, isMobile: true });
      const panel = w.find('aside');
      expect(panel.attributes('role')).toBe('dialog');
      expect(panel.attributes('aria-modal')).toBe('true');
    });

    it('adds aria-label to the close button', () => {
      const w = factory();
      const closeBtn = w
        .findAll('button')
        .find((b) => b.classes().includes('w-7') && b.classes().includes('h-7'));
      expect(closeBtn?.attributes('aria-label')).toBe('Close details panel');
    });
  });

  describe('size controls', () => {
    it('renders S/M/L buttons when showSizeControls is true (default)', () => {
      const w = factory();
      const sizeButtons = w.findAll('button').filter((b) => ['S', 'M', 'L'].includes(b.text()));
      expect(sizeButtons).toHaveLength(3);
    });

    it('hides size controls when showSizeControls is false', () => {
      const w = factory({ showSizeControls: false });
      const sizeButtons = w.findAll('button').filter((b) => ['S', 'M', 'L'].includes(b.text()));
      expect(sizeButtons).toHaveLength(0);
    });

    it('hides size controls on mobile even when showSizeControls is true', () => {
      const w = factory({ isMobile: true, showSizeControls: true });
      const sizeButtons = w.findAll('button').filter((b) => ['S', 'M', 'L'].includes(b.text()));
      expect(sizeButtons).toHaveLength(0);
    });

    it('emits update:size when a size button is clicked', async () => {
      const w = factory({ size: 'sm' });
      const mBtn = w.findAll('button').find((b) => b.text() === 'M');
      expect(mBtn).toBeDefined();
      await mBtn?.trigger('click');
      expect(w.emitted('update:size')?.[0]).toEqual(['md']);
    });

    it('emits update:size lg when L button is clicked', async () => {
      const w = factory({ size: 'sm' });
      const lBtn = w.findAll('button').find((b) => b.text() === 'L');
      expect(lBtn).toBeDefined();
      await lBtn?.trigger('click');
      expect(w.emitted('update:size')?.[0]).toEqual(['lg']);
    });

    it('emits update:size sm when S button is clicked', async () => {
      const w = factory({ size: 'lg' });
      const sBtn = w.findAll('button').find((b) => b.text() === 'S');
      expect(sBtn).toBeDefined();
      await sBtn?.trigger('click');
      expect(w.emitted('update:size')?.[0]).toEqual(['sm']);
    });
  });

  describe('full page button', () => {
    it('renders full page button when showFullPage is true', () => {
      const w = factory({ showFullPage: true });
      const fpBtn = w.findAll('button').find((b) => b.text().includes('Full Page'));
      expect(fpBtn).toBeTruthy();
    });

    it('does not render full page button when showFullPage is false (default)', () => {
      const w = factory();
      const fpBtn = w.findAll('button').find((b) => b.text().includes('Full Page'));
      expect(fpBtn).toBeUndefined();
    });

    it('emits full-page when full page button is clicked', async () => {
      const w = factory({ showFullPage: true });
      const fpBtn = w.findAll('button').find((b) => b.text().includes('Full Page'));
      expect(fpBtn).toBeDefined();
      await fpBtn?.trigger('click');
      expect(w.emitted('full-page')).toHaveLength(1);
    });
  });

  describe('panelFlex computed', () => {
    it('uses 30% for sm size', () => {
      const w = factory({ size: 'sm' });
      const style = w.find('aside').attributes('style');
      expect(style).toContain('flex: 0 0 30%');
    });

    it('uses 45% for md size', () => {
      const w = factory({ size: 'md' });
      const style = w.find('aside').attributes('style');
      expect(style).toContain('flex: 0 0 45%');
    });

    it('uses 70% for lg size', () => {
      const w = factory({ size: 'lg' });
      const style = w.find('aside').attributes('style');
      expect(style).toContain('flex: 0 0 70%');
    });

    it('does not set flex on mobile', () => {
      const w = factory({ isMobile: true, size: 'md' });
      const style = w.find('aside').attributes('style') ?? '';
      expect(style).not.toContain('flex: 0 0 45%');
    });
  });

  describe('slots', () => {
    it('renders header slot', () => {
      const w = factory({}, { header: '<h2 class="test-header">Title</h2>' });
      expect(w.find('.test-header').exists()).toBe(true);
    });

    it('renders subtitle slot', () => {
      const w = factory({}, { subtitle: '<span class="test-subtitle">Sub</span>' });
      expect(w.find('.test-subtitle').exists()).toBe(true);
    });

    it('renders tabs slot', () => {
      const w = factory({}, { tabs: '<div class="test-tabs">Tabs</div>' });
      expect(w.find('.test-tabs').exists()).toBe(true);
    });

    it('renders default slot', () => {
      const w = factory({}, { default: '<div class="test-content">Content</div>' });
      expect(w.find('.test-content').exists()).toBe(true);
    });

    it('renders toolbar slot', () => {
      const w = factory({}, { toolbar: '<button class="test-toolbar">Tool</button>' });
      expect(w.find('.test-toolbar').exists()).toBe(true);
    });
  });
});
