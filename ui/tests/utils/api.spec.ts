import { extractCollectionData } from '@/utils/api';

describe('extractCollectionData', () => {
  it('returns direct array payloads with object entries', () => {
    const payload = [{ id: 'a' }, { id: 'b' }];

    expect(extractCollectionData(payload)).toEqual(payload);
  });

  it('returns data envelope payloads with object entries', () => {
    const payload = { data: [{ id: 'a' }, { id: 'b' }] };

    expect(extractCollectionData(payload)).toEqual(payload.data);
  });

  it('returns items envelope payloads with object entries', () => {
    const payload = { items: [{ id: 'a' }, { id: 'b' }] };

    expect(extractCollectionData(payload)).toEqual(payload.items);
  });

  it('returns empty array when direct array contains non-object entries', () => {
    const payload = [{ id: 'a' }, 'invalid-item', null];

    expect(extractCollectionData(payload)).toEqual([]);
  });

  it('returns empty array when data envelope contains non-object entries', () => {
    const payload = { data: [{ id: 'a' }, 42] };

    expect(extractCollectionData(payload)).toEqual([]);
  });
});
