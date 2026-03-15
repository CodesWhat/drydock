import v8CoverageModule from '@vitest/coverage-v8';

const coverageProviderModule = {
  ...v8CoverageModule,
  async getProvider() {
    const provider = (await v8CoverageModule.getProvider()) as any;

    provider.cleanAfterRun = async () => {
      // Keep .tmp around until process exit to avoid ENOENT from late coverage writes.
      provider.coverageFiles = new Map<string, unknown>();
    };

    return provider;
  },
};

export default coverageProviderModule;
