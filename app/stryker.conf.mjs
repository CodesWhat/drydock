const dashboardReporterEnabled = Boolean(process.env.STRYKER_DASHBOARD_API_KEY);
const dashboardModule = process.env.STRYKER_DASHBOARD_MODULE || 'app';

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
  // perTest: each mutant runs only the tests that cover it, instead of
  // re-running the whole suite per mutant. Stryker's recommended default —
  // same mutation score, far less wall-clock time. Coverage is collected
  // via Stryker's own instrumentation, independent of the vitest provider.
  coverageAnalysis: 'perTest',
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
          module: dashboardModule,
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
