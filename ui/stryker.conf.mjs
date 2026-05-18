const dashboardReporterEnabled = Boolean(process.env.STRYKER_DASHBOARD_API_KEY);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  // src/boot/i18n.ts uses import.meta.glob(), a Vite compile-time macro whose
  // argument must stay a string literal. Stryker instrumentation rewrites that
  // literal into a mutant switch, which breaks Vite's glob parser and fails
  // every test that imports the i18n bootstrap. Exclude it from mutation.
  mutate: [
    'src/**/*.ts',
    '!src/boot/i18n.ts',
    '!src/**/*.typecheck.ts',
    '!src/**/*.d.ts',
    '!dist/**',
    '!coverage/**',
  ],
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  coverageAnalysis: 'off',
  reporters: [
    'clear-text',
    'progress',
    'html',
    'json',
    ...(dashboardReporterEnabled ? ['dashboard'] : []),
  ],
  htmlReporter: {
    fileName: 'reports/mutation/html/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
  ...(dashboardReporterEnabled
    ? {
        dashboard: {
          project: 'github.com/CodesWhat/drydock',
          module: 'ui',
          reportType: 'full',
        },
      }
    : {}),
  vitest: {
    configFile: 'vitest.stryker.config.ts',
    related: false,
  },
  incremental: true,
  thresholds: {
    high: 80,
    low: 70,
    break: 65,
  },
};

export default config;
