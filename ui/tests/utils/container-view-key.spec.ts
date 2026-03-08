import { getContainerViewKey } from '@/utils/container-view-key';

describe('container-view-key', () => {
  it('uses server and id when both values are present', () => {
    expect(
      getContainerViewKey({
        id: '5f3a',
        name: 'api',
        server: 'watcher-a',
      }),
    ).toBe('watcher-a::5f3a');
  });

  it('falls back to server and name when id is missing', () => {
    expect(
      getContainerViewKey({
        id: '',
        name: 'api',
        server: 'watcher-a',
      }),
    ).toBe('watcher-a::api');
  });

  it('falls back to id when server is missing', () => {
    expect(
      getContainerViewKey({
        id: '5f3a',
        name: 'api',
        server: '',
      }),
    ).toBe('5f3a');
  });

  it('falls back to name when server and id are missing', () => {
    expect(
      getContainerViewKey({
        id: '',
        name: 'api',
        server: '',
      }),
    ).toBe('api');
  });

  it('returns an empty key when no usable identity values are present', () => {
    expect(
      getContainerViewKey({
        id: 123,
        name: '   ',
        server: null,
      }),
    ).toBe('');
  });
});
