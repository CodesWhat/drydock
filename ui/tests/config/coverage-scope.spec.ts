// @vitest-environment node
import vitestConfig from '../../vitest.config';

describe('coverage scope enforcement', () => {
  it('enforces coverage thresholds for tested runtime modules', () => {
    const include = (vitestConfig.test?.coverage?.include ?? []) as string[];

    expect(include).toEqual(
      expect.arrayContaining([
        'src/services/**/*.ts',
        'src/composables/**/*.ts',
        'src/utils/**/*.ts',
        'src/theme/useTheme.ts',
      ]),
    );
  });
});
