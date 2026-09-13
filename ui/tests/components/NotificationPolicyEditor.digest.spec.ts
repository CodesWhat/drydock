import { flushPromises, mount } from '@vue/test-utils';
import NotificationPolicyEditor from '@/components/NotificationPolicyEditor.vue';
import { notificationOutcome, notificationSnapshot } from '../helpers/notification-editor';

const title = '${scan.alertCount} Security ALERTS';
const body = '  Hello Team\n${scan.summary}\nKeep CASE  ';
function digestSnapshot() {
  const snapshot = notificationSnapshot();
  Object.assign(snapshot.triggers[0].fields, {
    securitydigesttitle: {
      present: true,
      source: 'file',
      path: ['Notification', 'Discord', 'Policy', 'securitydigesttitle'],
      value: title,
      effectiveValue: title,
    },
    securitydigestbody: {
      present: true,
      source: 'file',
      path: ['Notification', 'Discord', 'Policy', 'securitydigestbody'],
      value: body,
      effectiveValue: body,
    },
  });
  return snapshot;
}
describe('security digest template form', () => {
  const wrappers: ReturnType<typeof mount>[] = [];
  afterEach(() => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    vi.unstubAllGlobals();
  });
  async function setup(snapshot = digestSnapshot(), outcome = notificationOutcome()) {
    const requests: Array<{ path: string; options?: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (path: string, options?: RequestInit) => {
        requests.push({ path, options });
        if (path !== '/api/v1/config/editor/triggers')
          throw new Error(`Unexpected request ${path}`);
        return Response.json(options?.method === 'PATCH' ? outcome : snapshot, {
          status: options?.method === 'PATCH' ? outcome.status : 200,
        });
      }),
    );
    const { id, type, name, agent } = snapshot.triggers[0];
    const wrapper = mount(NotificationPolicyEditor, {
      props: { trigger: { id, type, name, agent } },
    });
    wrappers.push(wrapper);
    await wrapper.get('[data-testid="edit-notification-policy"]').trigger('click');
    await flushPromises();
    return { wrapper, requests };
  }
  it('renders a title input and multiline body verbatim and leaves equal edits unsaved', async () => {
    const { wrapper, requests } = await setup();
    const titleInput = wrapper.get<HTMLInputElement>('input[data-field="securitydigesttitle"]');
    const bodyInput = wrapper.get<HTMLTextAreaElement>('textarea[data-field="securitydigestbody"]');
    expect(titleInput.element.value).toBe(title);
    expect(bodyInput.element.value).toBe(body);
    await titleInput.setValue(title);
    await bodyInput.setValue(body);
    expect(
      wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
    ).toBeDefined();
    await wrapper.get('form').trigger('submit');
    expect(requests).toHaveLength(1);
  });
  it('explains YAML interpolation without treating scan expressions as references', async () => {
    const { wrapper } = await setup();
    expect(wrapper.text()).toContain('${NAME}');
    expect(wrapper.text()).toContain('${NAME:-fallback}');
    expect(wrapper.text()).toContain('become read-only after reload');
    expect(wrapper.text()).toContain('Do not put secrets in templates');
    expect(wrapper.get<HTMLInputElement>('[data-field="securitydigesttitle"]').element.value).toBe(
      title,
    );
  });
  it('saves only changed templates without changing security mode or dispatching', async () => {
    const { wrapper, requests } = await setup();
    await wrapper.get('[data-field="securitydigesttitle"]').setValue(`${title}!`);
    await wrapper.get('[data-field="securitydigestbody"]').setValue(`${body}\nNew LINE`);
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(requests[1].options?.credentials).toBe('include');
    expect(JSON.parse(String(requests[1].options?.body))).toEqual({
      revision: 'initial',
      changes: [
        {
          path: ['Notification', 'Discord', 'Policy', 'securitydigesttitle'],
          operation: 'set',
          value: `${title}!`,
        },
        {
          path: ['Notification', 'Discord', 'Policy', 'securitydigestbody'],
          operation: 'set',
          value: `${body}\nNew LINE`,
        },
      ],
    });
    expect(wrapper.emitted('saved')).toEqual([
      [{ id: 'discord.policy', type: 'discord', name: 'policy', agent: undefined }],
    ]);
    expect(wrapper.text()).toContain('Saved and applied');
  });
  it('treats case-only changes as real edits and preserves whitespace-only strings', async () => {
    const { wrapper, requests } = await setup();
    await wrapper.get('[data-field="securitydigesttitle"]').setValue(title.toLowerCase());
    await wrapper.get('[data-field="securitydigestbody"]').setValue('  \n  ');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(String(requests[1].options?.body)).changes).toEqual([
      {
        path: ['Notification', 'Discord', 'Policy', 'securitydigesttitle'],
        operation: 'set',
        value: title.toLowerCase(),
      },
      {
        path: ['Notification', 'Discord', 'Policy', 'securitydigestbody'],
        operation: 'set',
        value: '  \n  ',
      },
    ]);
  });
  it('reloads a whole YAML interpolation as an omitted read-only reference', async () => {
    const snapshot = digestSnapshot();
    const { wrapper, requests } = await setup(snapshot);
    await wrapper.get('[data-field="securitydigesttitle"]').setValue('${NAME}');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(JSON.parse(String(requests[1].options?.body)).changes[0].value).toBe('${NAME}');
    Object.assign(snapshot.triggers[0].fields, {
      securitydigesttitle: {
        present: true,
        source: 'reference',
        readOnlyReason: 'referenced-field',
      },
    });
    await wrapper.get('[data-testid="reload-notification-policy"]').trigger('click');
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('[data-field="securitydigesttitle"]').element.value).toBe(
      '',
    );
    expect(wrapper.get('[data-field="securitydigesttitle"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('Source: reference');
    expect(requests).toHaveLength(3);
  });
  it.each(['environment', 'agent'])('keeps %s-owned templates disabled', async (owner) => {
    const snapshot = digestSnapshot();
    if (owner === 'agent') snapshot.triggers[0].agent = 'Local';
    Object.assign(snapshot.triggers[0].fields, {
      securitydigestbody: {
        present: true,
        source: owner === 'agent' ? 'file' : 'env',
        readOnlyReason: owner === 'agent' ? 'agent-trigger' : 'environment-owned',
        value: body,
      },
    });
    const { wrapper, requests } = await setup(snapshot);
    expect(wrapper.get('[data-field="securitydigestbody"]').attributes('disabled')).toBeDefined();
    expect(
      wrapper.get<HTMLTextAreaElement>('[data-field="securitydigestbody"]').element.value,
    ).toBe(owner === 'agent' ? '' : body);
    expect(requests).toHaveLength(1);
  });
  it('discards a template draft on an exact identity change', async () => {
    const { wrapper, requests } = await setup();
    await wrapper.get('[data-field="securitydigestbody"]').setValue('Draft');
    await wrapper.setProps({ trigger: { id: 'discord.other', type: 'discord', name: 'other' } });
    expect(wrapper.find('form').exists()).toBe(false);
    expect(wrapper.emitted('saved')).toBeUndefined();
    expect(requests).toHaveLength(1);
  });
  it.each(['securitydigesttitle', 'securitydigestbody'])(
    'rejects empty %s locally but permits explicit removal',
    async (field) => {
      const { wrapper, requests } = await setup();
      await wrapper.get(`[data-field="${field}"]`).setValue('');
      expect(
        wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
      ).toBeDefined();
      expect(wrapper.text()).toContain('Templates cannot be empty');
      await wrapper.get('form').trigger('submit');
      expect(requests).toHaveLength(1);
      await wrapper.get(`[data-reset="${field}"]`).trigger('click');
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(JSON.parse(String(requests[1].options?.body))).toEqual({
        revision: 'initial',
        changes: [{ path: ['Notification', 'Discord', 'Policy', field], operation: 'remove' }],
      });
    },
  );
  it('uses no fabricated default for absent templates and explains rendering-time defaults', async () => {
    const snapshot = digestSnapshot();
    Object.assign(snapshot.triggers[0].fields, {
      securitydigesttitle: {
        present: false,
        source: 'default',
        path: ['Notification', 'Discord', 'Policy', 'securitydigesttitle'],
      },
    });
    const { wrapper } = await setup(snapshot);
    expect(wrapper.get<HTMLInputElement>('[data-field="securitydigesttitle"]').element.value).toBe(
      '',
    );
    expect(wrapper.get('[data-reset="securitydigesttitle"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('built-in defaults when rendering');
    expect(wrapper.text()).toContain('does not change the security delivery mode');
  });
  it('keeps the six-field API usable with template controls unavailable', async () => {
    const { wrapper, requests } = await setup(notificationSnapshot());
    for (const field of ['securitydigesttitle', 'securitydigestbody'])
      expect(wrapper.get(`[data-field="${field}"]`).attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('This server does not provide this template field');
    await wrapper.get('[data-field="once"]').setValue('false');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(requests).toHaveLength(2);
  });
  it('explains MQTT unsupported fields without permitting template edits', async () => {
    const snapshot = digestSnapshot();
    Object.assign(snapshot.triggers[0], { id: 'mqtt.policy', type: 'mqtt' });
    for (const field of ['securitydigesttitle', 'securitydigestbody'])
      Object.assign(snapshot.triggers[0].fields, {
        [field]: { present: false, source: 'default', readOnlyReason: 'provider-unsupported' },
      });
    const { wrapper, requests } = await setup(snapshot);
    expect(wrapper.text()).toContain('This provider does not support security digest templates');
    for (const field of ['securitydigesttitle', 'securitydigestbody'])
      expect(wrapper.get(`[data-field="${field}"]`).attributes('disabled')).toBeDefined();
    expect(requests).toHaveLength(1);
  });
  it('hides reference values and cancels template edits without writes', async () => {
    const snapshot = digestSnapshot();
    Object.assign(snapshot.triggers[0].fields, {
      securitydigesttitle: {
        present: true,
        source: 'reference',
        readOnlyReason: 'referenced-field',
        value: 'private-reference',
        effectiveValue: 'private-effective',
      },
    });
    const { wrapper, requests } = await setup(snapshot);
    expect(wrapper.get<HTMLInputElement>('[data-field="securitydigesttitle"]').element.value).toBe(
      '',
    );
    expect(wrapper.html()).not.toContain('private-');
    await wrapper.get('[data-field="securitydigestbody"]').setValue('New Body');
    await wrapper.get('[data-testid="cancel-notification-policy"]').trigger('click');
    expect(wrapper.find('form').exists()).toBe(false);
    expect(requests).toHaveLength(1);
  });
  it.each([409, 200])(
    'retains exact template drafts after status%s and partial reload',
    async (status) => {
      const { wrapper, requests } = await setup(
        digestSnapshot(),
        notificationOutcome({
          status,
          saved: status === 200,
          applied: true,
          reload: { applied: false, errors: [] },
        }),
      );
      await wrapper.get('[data-field="securitydigestbody"]').setValue(`${body}\nChanged`);
      await wrapper.get('form').trigger('submit');
      await flushPromises();
      expect(
        wrapper.get<HTMLTextAreaElement>('[data-field="securitydigestbody"]').element.value,
      ).toBe(`${body}\nChanged`);
      expect(
        wrapper.get('[data-testid="save-notification-policy"]').attributes('disabled'),
      ).toBeDefined();
      expect(wrapper.text()).not.toContain('Saved and applied');
      expect(wrapper.emitted('saved')?.length ?? 0).toBe(status === 200 ? 1 : 0);
      expect(requests).toHaveLength(2);
    },
  );
});
