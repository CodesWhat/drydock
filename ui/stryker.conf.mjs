const dashboardReporterEnabled = Boolean(process.env.STRYKER_DASHBOARD_API_KEY);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  mutate: [
    'src/**/*.ts',
    '!src/**/*.stories.ts',
    '!src/**/*.typecheck.ts',
    '!src/**/*.d.ts',
    '!dist/**',
    '!coverage/**',
  ],
  testRunner: 'vitest',
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress', 'html', 'json', ...(dashboardReporterEnabled ? ['dashboard'] : [])],
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
    configFile: 'vitest.config.ts',
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
