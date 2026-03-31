const dashboardReporterEnabled = Boolean(process.env.STRYKER_DASHBOARD_API_KEY);

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  mutate: [
    '**/*.ts',
    '!**/*.d.ts',
    '!**/*.test.ts',
    '!**/*.fuzz.test.ts',
    '!**/*.typecheck.ts',
    '!test/**',
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
          module: 'app',
          reportType: 'full',
        },
      }
    : {}),
  vitest: {
    configFile: 'vitest.config.ts',
  },
  incremental: true,
  thresholds: {
    high: 80,
    low: 70,
    break: 65,
  },
};

export default config;
