import { encode } from 'uqr';
import TotpQrCode from '@/components/TotpQrCode.vue';
import { mountWithPlugins } from '../helpers/mount';

const URI = 'otpauth://totp/Drydock:eve?secret=JBSWY3DPEHPK3PXP&issuer=Drydock';

describe('TotpQrCode', () => {
  it('draws the code as an inline svg with a text alternative', () => {
    const wrapper = mountWithPlugins(TotpQrCode, { props: { value: URI, label: 'QR code' } });

    const svg = wrapper.get('svg');
    expect(svg.attributes('role')).toBe('img');
    expect(svg.attributes('aria-label')).toBe('QR code');
    expect(svg.attributes('shape-rendering')).toBe('crispEdges');
    const { size } = encode(URI, { ecc: 'M', border: 0 });
    expect(svg.attributes('viewBox')).toBe(`-4 -4 ${size + 8} ${size + 8}`);
    expect(wrapper.get('path').attributes('d')).toMatch(/^M\d/);
    wrapper.unmount();
  });

  it('draws one run per dark stretch of each row', () => {
    const wrapper = mountWithPlugins(TotpQrCode, { props: { value: URI, label: 'QR' } });

    const { data } = encode(URI, { ecc: 'M', border: 0 });
    let runs = 0;
    for (const row of data) {
      runs += row.filter((cell, x) => cell && !row[x - 1]).length;
    }
    expect(wrapper.get('path').attributes('d')?.match(/M/g)).toHaveLength(runs);
    wrapper.unmount();
  });

  it('never touches the network or embeds an external reference', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const wrapper = mountWithPlugins(TotpQrCode, { props: { value: URI, label: 'QR' } });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(wrapper.html()).not.toMatch(/<image|<img|href=|src=/i);
    expect(wrapper.html()).not.toContain('JBSWY3DPEHPK3PXP');
    vi.unstubAllGlobals();
    wrapper.unmount();
  });

  it('re-encodes when the value changes', async () => {
    const wrapper = mountWithPlugins(TotpQrCode, { props: { value: URI, label: 'QR' } });
    const before = wrapper.get('path').attributes('d');

    await wrapper.setProps({ value: `${URI}&period=30&digits=6&algorithm=SHA1` });

    expect(wrapper.get('path').attributes('d')).not.toBe(before);
    wrapper.unmount();
  });

  it('renders nothing and says so when the value cannot be encoded', () => {
    const wrapper = mountWithPlugins(TotpQrCode, {
      props: { value: 'x'.repeat(5000), label: 'QR' },
    });

    expect(wrapper.find('svg').exists()).toBe(false);
    expect(wrapper.get('[data-testid="totp-qr-failed"]').text()).toContain('QR');
    wrapper.unmount();
  });

  it('renders nothing for an empty value', () => {
    const wrapper = mountWithPlugins(TotpQrCode, { props: { value: '', label: 'QR' } });

    expect(wrapper.find('svg').exists()).toBe(false);
    wrapper.unmount();
  });
});
