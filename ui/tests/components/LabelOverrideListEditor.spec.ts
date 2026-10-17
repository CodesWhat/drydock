import { mount } from '@vue/test-utils';
import LabelOverrideListEditor from '@/components/LabelOverrideListEditor.vue';

const tid = (id: string) => `[data-testid="label-overrides-list-${id}"]`;

function mountEditor(props: Record<string, unknown> = {}) {
  return mount(LabelOverrideListEditor, {
    props: {
      modelValue: [] as string[],
      suggestions: ['slack.team', 'smtp.mail'],
      freeEntry: false,
      thresholds: false,
      inputLabel: 'Add entry',
      ...props,
    },
  });
}

const lastUpdate = (wrapper: ReturnType<typeof mountEditor>) =>
  wrapper.emitted('update:modelValue')?.at(-1)?.[0];

describe('LabelOverrideListEditor', () => {
  it('lists suggestions in a datalist and adds a suggested entry', async () => {
    const wrapper = mountEditor();
    expect(wrapper.findAll('datalist option').map((o) => o.attributes('value'))).toEqual([
      'slack.team',
      'smtp.mail',
    ]);
    await wrapper.find(tid('input')).setValue('slack.team');
    await wrapper.find(tid('add')).trigger('click');
    expect(lastUpdate(wrapper)).toEqual(['slack.team']);
    expect((wrapper.find(tid('input')).element as HTMLInputElement).value).toBe('');
  });

  it('adds on Enter and ignores an empty input', async () => {
    const wrapper = mountEditor({ freeEntry: true });
    expect(wrapper.find(tid('add')).attributes('disabled')).toBeDefined();
    await wrapper.find(tid('input')).setValue('  ghost  ');
    await wrapper.find(tid('input')).trigger('keydown.enter');
    expect(lastUpdate(wrapper)).toEqual(['ghost']);
    await wrapper.find(tid('input')).trigger('keydown.enter');
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1);
  });

  it('refuses a value outside the suggestions when free entry is off', async () => {
    const wrapper = mountEditor();
    await wrapper.find(tid('input')).setValue('ghost');
    expect(wrapper.find(tid('add')).attributes('disabled')).toBeDefined();
    await wrapper.find(tid('input')).setValue('SLACK.team');
    expect(wrapper.find(tid('add')).attributes('disabled')).toBeUndefined();
  });

  it('appends a threshold from the select when thresholds are on', async () => {
    const wrapper = mountEditor({ thresholds: true });
    expect(wrapper.findAll(`${tid('threshold')} option`)).toHaveLength(13);
    await wrapper.find(tid('input')).setValue('slack.team');
    await wrapper.find(tid('threshold')).setValue('minor');
    await wrapper.find(tid('add')).trigger('click');
    expect(lastUpdate(wrapper)).toEqual(['slack.team:minor']);
  });

  it('limits the thresholds to what the callback allows for the typed reference', async () => {
    const wrapper = mountEditor({
      thresholds: true,
      thresholdChoices: (reference: string) => (reference === 'slack.team' ? ['minor'] : []),
    });
    await wrapper.find(tid('input')).setValue('slack.team');
    expect(wrapper.findAll(`${tid('threshold')} option`).map((o) => o.attributes('value'))).toEqual(
      ['minor'],
    );
    await wrapper.find(tid('add')).trigger('click');
    expect(lastUpdate(wrapper)).toEqual(['slack.team:minor']);
    await wrapper.find(tid('input')).setValue('smtp.mail');
    expect(wrapper.find(tid('add')).attributes('disabled')).toBeDefined();
  });

  it('removes an entry but keeps the locked ones', async () => {
    const wrapper = mountEditor({ modelValue: ['a', 'b', 'c'], lockedCount: 1 });
    const entries = wrapper.findAll(tid('entry'));
    expect(entries.map((entry) => entry.text())).toEqual([
      expect.stringContaining('a'),
      expect.stringContaining('b'),
      expect.stringContaining('c'),
    ]);
    expect(entries[0].attributes('data-locked')).toBe('true');
    expect(wrapper.find('[data-testid="label-overrides-list-remove-a"]').exists()).toBe(false);
    await wrapper.find('[data-testid="label-overrides-list-remove-b"]').trigger('click');
    expect(lastUpdate(wrapper)).toEqual(['a', 'c']);
  });

  it('hides the add row when nothing can be added and disables everything when disabled', () => {
    const wrapper = mountEditor({ modelValue: ['a'], canAdd: false });
    expect(wrapper.find(tid('input')).exists()).toBe(false);
    const disabled = mountEditor({ modelValue: ['a'], disabled: true });
    expect(disabled.find(tid('input')).attributes('disabled')).toBeDefined();
    expect(
      disabled.find('[data-testid="label-overrides-list-remove-a"]').attributes('disabled'),
    ).toBeDefined();
  });
});
