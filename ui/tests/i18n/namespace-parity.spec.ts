import { missingNamespaces } from './namespace-parity';

describe('namespace completeness', () => {
  const source = ['dashboardView.json', 'containerComponents.json'];

  it('reports a missing namespace even when the other namespace exists', () => {
    expect(missingNamespaces(source, ['containerComponents.json'])).toEqual(['dashboardView.json']);
  });

  it('reports every namespace when a locale directory is absent or empty', () => {
    expect(missingNamespaces(source, [])).toEqual(source);
  });

  it('accepts a complete locale regardless of file order or extra files', () => {
    expect(
      missingNamespaces(source, ['containerComponents.json', 'README.md', 'dashboardView.json']),
    ).toEqual([]);
  });

  it('requires the exact namespace filename', () => {
    expect(missingNamespaces(['dashboardView.json'], ['DashboardView.json'])).toEqual([
      'dashboardView.json',
    ]);
  });
});
