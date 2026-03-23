import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import DetailField from '@/components/DetailField.vue';

describe('DetailField', () => {
  it('renders label text in the first div', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Image' },
      slots: { default: 'nginx:latest' },
    });

    const labelDiv = wrapper.get('.dd-text-label');
    expect(labelDiv.text()).toBe('Image');
  });

  it('renders slot content in the second div', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Tag' },
      slots: { default: '<span class="custom">v1.2.3</span>' },
    });

    const valueDiv = wrapper.get('.text-2xs-plus');
    expect(valueDiv.get('.custom').text()).toBe('v1.2.3');
  });

  it('label div uses dd-text-label class', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Status' },
      slots: { default: 'running' },
    });

    const divs = wrapper.findAll('div');
    const labelDiv = divs[1];

    expect(labelDiv.classes()).toContain('dd-text-label');
  });

  it('value div uses text-2xs-plus class', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Status' },
      slots: { default: 'running' },
    });

    const valueDiv = wrapper.get('.text-2xs-plus');
    expect(valueDiv.classes()).toContain('text-2xs-plus');
  });

  it('applies mb-0.5 when compact is true', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Port', compact: true },
      slots: { default: '8080' },
    });

    const labelDiv = wrapper.get('.dd-text-label');
    expect(labelDiv.classes()).toContain('mb-0.5');
    expect(labelDiv.classes()).not.toContain('mb-1');
  });

  it('applies mb-1 when compact is false', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Port', compact: false },
      slots: { default: '8080' },
    });

    const labelDiv = wrapper.get('.dd-text-label');
    expect(labelDiv.classes()).toContain('mb-1');
    expect(labelDiv.classes()).not.toContain('mb-0.5');
  });

  it('applies font-mono to value div when mono is true', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Hash', mono: true },
      slots: { default: 'abc123def' },
    });

    const valueDiv = wrapper.get('.text-2xs-plus');
    expect(valueDiv.classes()).toContain('font-mono');
  });

  it('defaults to mono=false and compact=false', () => {
    const wrapper = mount(DetailField, {
      props: { label: 'Name' },
      slots: { default: 'drydock' },
    });

    const labelDiv = wrapper.get('.dd-text-label');
    expect(labelDiv.classes()).toContain('mb-1');
    expect(labelDiv.classes()).not.toContain('mb-0.5');

    const valueDiv = wrapper.get('.text-2xs-plus');
    expect(valueDiv.classes()).not.toContain('font-mono');
  });
});
