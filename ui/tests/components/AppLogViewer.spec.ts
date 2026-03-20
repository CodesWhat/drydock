import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import AppLogViewer from '@/components/AppLogViewer.vue';
import type { AppLogEntry } from '@/types/log-entry';

function makeEntry(id: number, overrides: Partial<AppLogEntry> = {}): AppLogEntry {
  const plainLine = overrides.plainLine ?? `line-${id}`;

  return {
    id,
    timestamp: overrides.timestamp ?? `2026-03-19T00:00:0${id}Z`,
    line: overrides.line ?? plainLine,
    plainLine,
    ansiSegments: overrides.ansiSegments ?? [
      {
        text: plainLine,
        color: null,
        bold: false,
        dim: false,
      },
    ],
    json: overrides.json ?? null,
    level: overrides.level,
    channel: overrides.channel,
    component: overrides.component,
  };
}

function mountViewer(props: Record<string, unknown> = {}) {
  return mount(AppLogViewer, {
    props: {
      entries: [],
      ...props,
    },
    global: {
      stubs: {
        AppIcon: {
          template: '<span class="app-icon-stub" />',
        },
      },
    },
  });
}

function getButtonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().includes(text));
  if (!button) {
    throw new Error(`Button not found: ${text}`);
  }
  return button;
}

function setViewportMetrics(
  viewport: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; scrollTop: number },
): void {
  Object.defineProperty(viewport, 'scrollHeight', {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(viewport, 'clientHeight', {
    configurable: true,
    value: metrics.clientHeight,
  });
  viewport.scrollTop = metrics.scrollTop;
}

describe('AppLogViewer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders empty state and custom footer status details', () => {
    const wrapper = mountViewer({
      entries: [],
      emptyMessage: 'Nothing to show',
      lineCount: 42,
      statusLabel: 'Connected',
    });

    expect(wrapper.get('[data-test="app-log-viewer"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('Nothing to show');
    expect(wrapper.text()).toContain('42 lines');
    expect(wrapper.text()).toContain('Connected');
  });

  it('renders ANSI segments with expected color, bold, and dim styles', () => {
    const wrapper = mountViewer({
      entries: [
        makeEntry(1, {
          plainLine: 'colored output',
          ansiSegments: [
            {
              text: 'ERR',
              color: 'red',
              bold: true,
              dim: false,
            },
            {
              text: ' low-priority',
              color: null,
              bold: false,
              dim: true,
            },
          ],
        }),
      ],
    });

    const row = wrapper.get('[data-test="container-log-row"]');
    const spanStyles = row.findAll('span').map((segment) => segment.attributes('style') ?? '');

    expect(spanStyles.some((style) => style.includes('color: var(--dd-danger)'))).toBe(true);
    expect(spanStyles.some((style) => style.includes('font-weight: 700'))).toBe(true);
    expect(spanStyles.some((style) => style.includes('opacity: var(--dd-opacity-dim)'))).toBe(true);
  });

  it('tokenizes JSON log entries into semantic token classes', () => {
    const wrapper = mountViewer({
      entries: [
        makeEntry(1, {
          plainLine: '{"msg":"ok"}',
          json: {
            level: 'info',
            value: {
              msg: 'ok',
              count: 3,
              enabled: true,
              data: null,
            },
            pretty: '{\n  "msg": "ok",\n  "count": 3,\n  "enabled": true,\n  "data": null\n}',
          },
          ansiSegments: [],
        }),
      ],
    });

    expect(wrapper.find('pre').exists()).toBe(true);
    expect(wrapper.find('.json-key').text()).toContain('"msg"');
    expect(wrapper.find('.json-string').text()).toContain('"ok"');
    expect(wrapper.find('.json-number').text()).toContain('3');
    expect(wrapper.find('.json-boolean').text()).toContain('true');
    expect(wrapper.find('.json-null').text()).toContain('null');
    expect(wrapper.findAll('.json-punctuation').length).toBeGreaterThan(0);
  });

  it('emits pause and pin toggle events from toolbar controls', async () => {
    const wrapper = mountViewer({
      entries: [makeEntry(1)],
      paused: false,
      autoScrollPinned: true,
    });

    await wrapper.get('[data-test="container-log-toggle-pause"]').trigger('click');
    await getButtonByText(wrapper, 'Unpin').trigger('click');

    expect(wrapper.emitted('toggle-pause')).toHaveLength(1);
    expect(wrapper.emitted('toggle-pin')).toHaveLength(1);
  });

  it('pins and scrolls to bottom when pinning from an unpinned state', async () => {
    const wrapper = mountViewer({
      entries: [makeEntry(1)],
      autoScrollPinned: false,
    });

    const viewport = wrapper.get('div.overflow-auto.font-mono').element as HTMLElement;
    setViewportMetrics(viewport, {
      scrollHeight: 700,
      clientHeight: 100,
      scrollTop: 10,
    });

    await getButtonByText(wrapper, 'Pin').trigger('click');
    await nextTick();

    expect(wrapper.emitted('toggle-pin')).toHaveLength(1);
    expect(viewport.scrollTop).toBe(700);
  });

  it('emits pin toggle on user scroll when leaving bottom proximity', async () => {
    const wrapper = mountViewer({
      entries: [makeEntry(1)],
      autoScrollPinned: true,
    });

    const viewport = wrapper.get('div.overflow-auto.font-mono').element as HTMLElement;
    setViewportMetrics(viewport, {
      scrollHeight: 1000,
      clientHeight: 100,
      scrollTop: 100,
    });

    await wrapper.get('div.overflow-auto.font-mono').trigger('scroll');

    expect(wrapper.emitted('toggle-pin')).toHaveLength(1);
  });

  it('supports search highlighting and next-match navigation with scroll targeting', async () => {
    const wrapper = mountViewer({
      entries: [
        makeEntry(1, { plainLine: 'alpha started' }),
        makeEntry(2, { plainLine: 'beta step' }),
        makeEntry(3, { plainLine: 'alpha finished' }),
      ],
    });

    await wrapper.get('[data-test="container-log-search-input"]').setValue('alpha');
    await nextTick();

    const rows = wrapper.findAll('[data-test="container-log-row"]');
    for (const row of rows) {
      (row.element as HTMLElement).scrollIntoView = vi.fn();
    }

    expect(wrapper.get('[data-test="container-log-match-index"]').text()).toBe('1 / 2');
    expect(rows[0].classes()).toContain('ring-1');
    expect(rows[0].classes()).toContain('bg-drydock-secondary/10');
    expect(rows[2].classes()).toContain('ring-1');

    await wrapper.get('[data-test="container-log-next-match"]').trigger('click');
    await nextTick();

    expect(wrapper.get('[data-test="container-log-match-index"]').text()).toBe('2 / 2');
    expect(rows[2].classes()).toContain('bg-drydock-secondary/10');
    expect((rows[2].element as HTMLElement).scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
    });
  });

  it('surfaces regex errors and disables match navigation when regex is invalid', async () => {
    const wrapper = mountViewer({
      entries: [makeEntry(1, { plainLine: 'hello world' })],
    });

    await wrapper.get('[data-test="container-log-regex-toggle"]').trigger('click');
    await wrapper.get('[data-test="container-log-search-input"]').setValue('[');
    await nextTick();

    expect(wrapper.text()).toContain('Invalid regular expression');
    expect(
      wrapper.get('[data-test="container-log-prev-match"]').attributes('disabled'),
    ).toBeDefined();
    expect(
      wrapper.get('[data-test="container-log-next-match"]').attributes('disabled'),
    ).toBeDefined();
  });

  it('copies formatted logs to clipboard and shows a temporary success state', async () => {
    vi.useFakeTimers();

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    });

    const wrapper = mountViewer({
      entries: [
        makeEntry(1, {
          timestamp: '2026-03-19T00:00:00Z',
          channel: 'stdout',
          component: 'api',
          plainLine: 'ready',
        }),
        makeEntry(2, {
          timestamp: '2026-03-19T00:00:01Z',
          level: 'warn',
          component: 'worker',
          plainLine: 'retrying',
        }),
      ],
    });

    await wrapper.get('[data-test="container-log-copy"]').trigger('click');
    await flushPromises();

    expect(writeText).toHaveBeenCalledWith(
      '2026-03-19T00:00:00Z STDOUT api ready\n2026-03-19T00:00:01Z WARN worker retrying',
    );
    expect(wrapper.get('[data-test="container-log-copy"]').text()).toContain('Copied');

    vi.advanceTimersByTime(2000);
    await nextTick();

    expect(wrapper.get('[data-test="container-log-copy"]').text()).toContain('Copy');
  });
});
