import { flushPromises } from '@vue/test-utils';
import TriggerSkipsPanel from '@/components/TriggerSkipsPanel.vue';
import { resetPreferences } from '@/preferences/store';
import TriggersView from '@/views/TriggersView.vue';
import { dataViewStubs } from '../helpers/data-view-stubs';
import { mountWithPlugins } from '../helpers/mount';

vi.mock('vue-router', () => ({ useRoute: () => ({ query: {} }) }));

describe('trigger recent skips', () => {
  beforeEach(() => resetPreferences());
  afterEach(() => vi.unstubAllGlobals());

  async function open(type: string, agent: string | null = null) {
    const trigger = { id: `${type}.policy`, type, name: 'policy', agent, configuration: {} };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string) => {
        if (path === '/api/v1/triggers') return Response.json({ data: [trigger], total: 1 });
        if (path.startsWith('/api/v1/triggers/')) return Response.json(trigger);
        if (path.startsWith('/api/v1/config/editor/')) return Response.json({});
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    const wrapper = mountWithPlugins(TriggersView, { global: { stubs: dataViewStubs } });
    await flushPromises();
    await wrapper.get('.row-click-first').trigger('click');
    await flushPromises();
    return wrapper;
  }

  it('lists recent skips for a notification trigger', async () => {
    const wrapper = await open('discord', 'edge');
    try {
      expect(wrapper.findComponent(TriggerSkipsPanel).props('trigger')).toEqual({
        type: 'discord',
        name: 'policy',
        agent: 'edge',
      });
    } finally {
      wrapper.unmount();
    }
  });

  it('does not list skips for an action trigger', async () => {
    const wrapper = await open('docker');
    try {
      expect(wrapper.findComponent(TriggerSkipsPanel).exists()).toBe(false);
    } finally {
      wrapper.unmount();
    }
  });
});
