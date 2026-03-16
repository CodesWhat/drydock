import v8CoverageModule from '@vitest/coverage-v8';

type V8CoverageProvider = Awaited<ReturnType<(typeof v8CoverageModule)['getProvider']>>;

interface V8CoverageProviderWithInternalState extends V8CoverageProvider {
  cleanAfterRun: () => Promise<void>;
  coverageFiles: Map<string, unknown>;
}

const coverageProviderModule = {
  ...v8CoverageModule,
  async getProvider() {
    const provider = (await v8CoverageModule.getProvider()) as V8CoverageProviderWithInternalState;

    provider.cleanAfterRun = async () => {
      // Keep .tmp around until process exit to avoid ENOENT from late coverage writes.
      provider.coverageFiles = new Map<string, unknown>();
    };

    return provider;
  },
};

export default coverageProviderModule;
