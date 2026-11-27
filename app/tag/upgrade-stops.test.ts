import { getActiveUpgradeStop, isWithinUpgradeStop, parseUpgradeStops } from './upgrade-stops.js';

const running = (...segments: string[]) => ({ segments, flavor: '' });

describe('parseUpgradeStops', () => {
  test('returns nothing for undefined and blank input', () => {
    expect(parseUpgradeStops(undefined)).toEqual({ stops: [], invalid: [] });
    expect(parseUpgradeStops(' , ')).toEqual({ stops: [], invalid: [] });
  });

  test('parses, trims, drops a v prefix, sorts ascending and de-duplicates', () => {
    const { stops, invalid } = parseUpgradeStops('29, v27 ,28,27,13.8.8,13.8,13.12.15');
    expect(invalid).toEqual([]);
    expect(stops).toEqual([
      ['13', '8'],
      ['13', '8', '8'],
      ['13', '12', '15'],
      ['27'],
      ['28'],
      ['29'],
    ]);
  });

  test('sorts numerically, not lexically', () => {
    expect(parseUpgradeStops('100,9,010').stops).toEqual([['9'], ['010'], ['100']]);
  });

  test('reports entries that are not dotted numbers', () => {
    const { stops, invalid } = parseUpgradeStops('27,latest,1.x,28');
    expect(stops).toEqual([['27'], ['28']]);
    expect(invalid).toEqual(['latest', '1.x']);
  });
});

describe('getActiveUpgradeStop', () => {
  const { stops } = parseUpgradeStops('27,28,29');

  test('picks the first stop the running version has not reached', () => {
    expect(getActiveUpgradeStop(stops, running('26', '0', '5'))).toEqual(['27']);
    expect(getActiveUpgradeStop(stops, running('27', '1', '0'))).toEqual(['28']);
    expect(getActiveUpgradeStop(stops, running('28'))).toEqual(['29']);
  });

  test('returns undefined once every stop is reached', () => {
    expect(getActiveUpgradeStop(stops, running('29', '0', '1'))).toBeUndefined();
    expect(getActiveUpgradeStop(stops, running('30'))).toBeUndefined();
  });

  test('full-version stops compare to their own depth', () => {
    const gitlab = parseUpgradeStops('13.8.8,13.12.15').stops;
    expect(getActiveUpgradeStop(gitlab, running('13', '5', '0'))).toEqual(['13', '8', '8']);
    expect(getActiveUpgradeStop(gitlab, running('13', '8', '7'))).toEqual(['13', '8', '8']);
    expect(getActiveUpgradeStop(gitlab, running('13', '8', '8'))).toEqual(['13', '12', '15']);
    expect(getActiveUpgradeStop(gitlab, running('13', '12', '15'))).toBeUndefined();
  });

  test('missing running segments count as zero', () => {
    expect(getActiveUpgradeStop(parseUpgradeStops('13.8.8').stops, running('13', '8'))).toEqual([
      '13',
      '8',
      '8',
    ]);
  });
});

describe('isWithinUpgradeStop', () => {
  test('major stop allows the whole stop major and nothing above', () => {
    expect(isWithinUpgradeStop(['27'], '27.0.2')).toBe(true);
    expect(isWithinUpgradeStop(['27'], '27.9.9')).toBe(true);
    expect(isWithinUpgradeStop(['27'], '26.0.13')).toBe(true);
    expect(isWithinUpgradeStop(['27'], '28.0.0')).toBe(false);
    expect(isWithinUpgradeStop(['27'], '30.1.0')).toBe(false);
  });

  test('full-version stop caps at exactly that version', () => {
    const stop = ['13', '8', '8'];
    expect(isWithinUpgradeStop(stop, '13.8.8')).toBe(true);
    expect(isWithinUpgradeStop(stop, '13.8.7')).toBe(true);
    expect(isWithinUpgradeStop(stop, '13.8.9')).toBe(false);
    expect(isWithinUpgradeStop(stop, '13.9.0')).toBe(false);
    expect(isWithinUpgradeStop(stop, '14.0.0')).toBe(false);
  });

  test('rejects a candidate with no numeric version', () => {
    expect(isWithinUpgradeStop(['27'], 'latest')).toBe(false);
  });
});
