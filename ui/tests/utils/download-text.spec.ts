import { downloadTextFile } from '@/utils/download-text';

describe('downloadTextFile', () => {
  const createObjectURL = vi.fn(() => 'blob:abc');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clicks a temporary link to the text and cleans up after itself', () => {
    const clicked: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push({ href: this.href, download: this.download });
      expect(document.body.contains(this)).toBe(true);
    });

    expect(downloadTextFile('codes.txt', 'one\ntwo')).toBe(true);

    expect(clicked).toEqual([{ href: 'blob:abc', download: 'codes.txt' }]);
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0];
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(blob.size).toBe(7);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:abc');
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('reports false when the browser cannot make an object URL', () => {
    vi.stubGlobal('URL', {});

    expect(downloadTextFile('codes.txt', 'x')).toBe(false);
  });
});
