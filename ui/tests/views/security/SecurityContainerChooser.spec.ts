import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import SecurityContainerChooser from '@/views/security/SecurityContainerChooser.vue';
import type { ContainerChoice } from '@/views/security/securityViewTypes';

const choices: ContainerChoice[] = [
  {
    id: 'web',
    name: 'web',
    host: 'docker.local',
    newTag: '1.2.3',
    blocked: false,
  },
  {
    id: 'api',
    name: 'api',
    host: 'prod-node',
    blocked: true,
    blockerMessage: 'Pinned by policy',
  },
];

function factory() {
  return mount(SecurityContainerChooser, {
    props: { choices },
    attachTo: document.body,
    global: {
      directives: {
        tooltip: {},
      },
    },
  });
}

describe('SecurityContainerChooser', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('dismisses when the overlay background is pressed', async () => {
    const wrapper = factory();
    const overlay = document.body.querySelector('.z-overlay');

    overlay?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('dismisses from the cancel action', async () => {
    const wrapper = factory();
    const cancelButton = [...document.body.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Cancel',
    );

    cancelButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await nextTick();

    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('opens enabled choices and blocks disabled choices', async () => {
    const wrapper = factory();
    const [enabledChoice, blockedChoice] = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[data-test="security-chooser-item"]'),
    ];

    expect(enabledChoice.disabled).toBe(false);
    expect(blockedChoice.disabled).toBe(true);

    blockedChoice.click();
    await nextTick();
    expect(wrapper.emitted('openChoice')).toBeUndefined();

    enabledChoice.click();
    await nextTick();
    expect(wrapper.emitted('openChoice')).toEqual([[choices[0]]]);
    wrapper.unmount();
  });

  it('emits viewAll from the footer action', async () => {
    const wrapper = factory();
    const viewAllButton = document.body.querySelector<HTMLButtonElement>(
      '[data-test="security-chooser-view-all"]',
    );

    viewAllButton?.click();
    await nextTick();

    expect(wrapper.emitted('viewAll')).toHaveLength(1);
    wrapper.unmount();
  });

  it('traps tab focus inside the modal controls', async () => {
    const outsideButton = document.createElement('button');
    outsideButton.textContent = 'Outside';
    document.body.appendChild(outsideButton);

    const wrapper = factory();
    await nextTick();

    const focusableButtons = [
      ...document.body.querySelectorAll<HTMLButtonElement>(
        '[data-test="security-chooser-item"]:not(:disabled), [data-test="security-chooser-view-all"], .z-overlay button:not(:disabled)',
      ),
    ];
    const firstButton = focusableButtons[0];
    const lastButton = focusableButtons.at(-1);

    expect(document.activeElement).toBe(firstButton);

    firstButton.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }),
    );
    await nextTick();
    expect(document.activeElement).toBe(lastButton);

    lastButton?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    await nextTick();
    expect(document.activeElement).toBe(firstButton);
    expect(document.activeElement).not.toBe(outsideButton);

    wrapper.unmount();
  });
});
