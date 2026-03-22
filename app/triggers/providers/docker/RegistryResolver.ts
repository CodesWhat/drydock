import TriggerPipelineError from './TriggerPipelineError.js';

type RegistryState = Record<PropertyKey, unknown>;

type RegistryManagerCandidate = {
  getAuthPull?: (...args: unknown[]) => unknown;
  getImageFullName?: (...args: unknown[]) => unknown;
  normalizeImage?: (...args: unknown[]) => unknown;
  match?: (...args: unknown[]) => unknown;
  getId?: (...args: unknown[]) => unknown;
};

type RegistryCompatibilityOptions = {
  requireNormalizeImage?: boolean;
};

type RegistryLookupOptions = {
  source?: string;
  registryName?: unknown;
  requiredMethods?: string[];
  requireNormalizeImage?: boolean;
};

type RegistryResolveOptions = {
  allowAnonymousFallback?: boolean;
  requireNormalizeImage?: boolean;
  registryName?: unknown;
};

function toPropertyKey(value: unknown): PropertyKey {
  return typeof value === 'symbol' ? value : String(value);
}

class RegistryResolver {
  normalizeRegistryHost(registryUrlOrName) {
    if (typeof registryUrlOrName !== 'string') {
      return undefined;
    }
    const registryHostCandidate = registryUrlOrName.trim();
    if (registryHostCandidate === '') {
      return undefined;
    }

    try {
      if (/^https?:\/\//i.test(registryHostCandidate)) {
        return new URL(registryHostCandidate).host;
      }
    } catch {
      return undefined;
    }

    return registryHostCandidate
      .replace(/^https?:\/\//i, '')
      .replace(/\/v2\/?$/i, '')
      .replace(/\/+$/, '');
  }

  buildRegistryLookupCandidates(image) {
    if (!image) {
      return [];
    }
    const candidates = [image];
    const registryUrl = image.registry?.url;

    if (typeof registryUrl !== 'string' || registryUrl.trim() === '') {
      return candidates;
    }

    const trimmedRegistryUrl = registryUrl.trim();
    const normalizedRegistryHost = this.normalizeRegistryHost(trimmedRegistryUrl);
    if (normalizedRegistryHost) {
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: normalizedRegistryHost,
        },
      });
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: `http://${normalizedRegistryHost}`,
        },
      });
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: `https://${normalizedRegistryHost}`,
        },
      });
    }

    const registryUrlWithoutV2 = trimmedRegistryUrl.replace(/\/v2\/?$/i, '');
    if (registryUrlWithoutV2 !== trimmedRegistryUrl) {
      candidates.push({
        ...image,
        registry: {
          ...image.registry,
          url: registryUrlWithoutV2,
        },
      });
    }

    return candidates;
  }

  isRegistryManagerCompatible(registry, options: RegistryCompatibilityOptions = {}) {
    const { requireNormalizeImage = false } = options;
    if (!registry || typeof registry !== 'object') {
      return false;
    }
    const registryCandidate = registry as RegistryManagerCandidate;
    if (typeof registryCandidate.getAuthPull !== 'function') {
      return false;
    }
    if (typeof registryCandidate.getImageFullName !== 'function') {
      return false;
    }
    if (requireNormalizeImage && typeof registryCandidate.normalizeImage !== 'function') {
      return false;
    }
    return true;
  }

  createAnonymousRegistryManager(container, logContainer) {
    const registryName = container?.image?.registry?.name;
    const registryUrl = container?.image?.registry?.url;
    const registryHost = this.normalizeRegistryHost(registryUrl);

    if (!registryHost) {
      return undefined;
    }

    const imageName = container?.image?.name;
    if (typeof imageName !== 'string' || imageName.trim() === '') {
      return undefined;
    }

    logContainer.info?.(
      `Registry manager "${registryName}" is not configured; using anonymous pull mode for "${registryHost}"`,
    );

    return {
      getAuthPull: async () => undefined,
      getImageFullName: (image, tagOrDigest) => {
        const imageNameResolved = String(image?.name ?? '').replace(/^\/+/, '');
        if (imageNameResolved === '') {
          throw new TriggerPipelineError(
            'registry-image-name-missing',
            'Container image name is missing',
            {
              source: 'RegistryResolver',
            },
          );
        }

        const tagOrDigestResolved = String(tagOrDigest ?? '').trim();
        if (tagOrDigestResolved === '') {
          throw new TriggerPipelineError(
            'registry-image-tag-missing',
            'Container image tag/digest is missing',
            {
              source: 'RegistryResolver',
            },
          );
        }

        const separator = tagOrDigestResolved.includes(':') ? '@' : ':';
        return `${registryHost}/${imageNameResolved}${separator}${tagOrDigestResolved}`;
      },
      normalizeImage: (image) => {
        const normalizedImage = structuredClone(image);
        normalizedImage.registry = normalizedImage.registry || {};
        normalizedImage.registry.url = registryHost;
        normalizedImage.registry.name =
          registryName || normalizedImage.registry.name || 'anonymous';
        return normalizedImage;
      },
    };
  }

  getRequiredRegistryManagerMethods(requireNormalizeImage = false) {
    const requiredMethods = ['getAuthPull', 'getImageFullName'];
    if (requireNormalizeImage) {
      requiredMethods.push('normalizeImage');
    }
    return requiredMethods;
  }

  ensureCompatibleRegistryManager(registryManager, options: RegistryLookupOptions = {}) {
    const {
      source = 'unknown',
      registryName,
      requiredMethods = [],
      requireNormalizeImage = false,
    } = options;

    if (!registryManager) {
      return undefined;
    }

    if (
      !this.isRegistryManagerCompatible(registryManager, {
        requireNormalizeImage,
      })
    ) {
      throw new TriggerPipelineError(
        'registry-manager-misconfigured',
        `Registry manager "${registryName}" is misconfigured (${source}); expected methods: ${requiredMethods.join(', ')}`,
        {
          source: 'RegistryResolver',
        },
      );
    }

    return registryManager;
  }

  findRegistryManagerByName(
    registryState: RegistryState = {},
    options: RegistryLookupOptions = {},
  ) {
    const { registryName, requiredMethods = [], requireNormalizeImage = false } = options;

    return this.ensureCompatibleRegistryManager(registryState[toPropertyKey(registryName)], {
      source: 'lookup by name',
      registryName,
      requiredMethods,
      requireNormalizeImage,
    });
  }

  findRegistryManagerByImageCandidate(registryState: RegistryState = {}, imageCandidate) {
    for (const registryManager of Object.values(registryState)) {
      if (!registryManager || typeof registryManager !== 'object') {
        continue;
      }
      const registryManagerCandidate = registryManager as RegistryManagerCandidate;
      if (typeof registryManagerCandidate.match !== 'function') {
        continue;
      }

      try {
        if (registryManagerCandidate.match(imageCandidate)) {
          return registryManagerCandidate;
        }
      } catch {
        // Ignore matcher errors and continue checking other registries.
      }
    }

    return undefined;
  }

  findRegistryManagerByImageMatch(
    container,
    logContainer,
    registryState: RegistryState = {},
    options: RegistryLookupOptions = {},
  ) {
    const { registryName, requiredMethods = [], requireNormalizeImage = false } = options;
    const lookupCandidates = this.buildRegistryLookupCandidates(container?.image);

    for (const imageCandidate of lookupCandidates) {
      const byMatch = this.findRegistryManagerByImageCandidate(registryState, imageCandidate);
      const byMatchCompatible = this.ensureCompatibleRegistryManager(byMatch, {
        source: 'lookup by image match',
        registryName,
        requiredMethods,
        requireNormalizeImage,
      });

      if (!byMatchCompatible) {
        continue;
      }

      const matchedRegistryId =
        typeof byMatchCompatible.getId === 'function' ? byMatchCompatible.getId() : 'unknown';
      logContainer.debug?.(
        `Resolved registry manager "${registryName}" using matcher "${matchedRegistryId}"`,
      );
      return byMatchCompatible;
    }

    return undefined;
  }

  createUnsupportedRegistryManagerError(registryState: RegistryState = {}, registryName) {
    const knownRegistries = Object.keys(registryState);
    const knownRegistriesAsString =
      knownRegistries.length > 0 ? knownRegistries.join(', ') : 'none';

    return new TriggerPipelineError(
      'registry-manager-unsupported',
      `Unsupported registry manager "${registryName}". Known registries: ${knownRegistriesAsString}. Configure a matching registry or provide a valid registry URL.`,
      {
        source: 'RegistryResolver',
      },
    );
  }

  resolveRegistryManager(
    container,
    logContainer,
    registryState: RegistryState = {},
    options: RegistryResolveOptions = {},
  ) {
    const {
      allowAnonymousFallback = false,
      requireNormalizeImage = false,
      registryName = container?.image?.registry?.name,
    } = options;
    const requiredMethods = this.getRequiredRegistryManagerMethods(requireNormalizeImage);
    const registryLookupOptions = {
      registryName,
      requiredMethods,
      requireNormalizeImage,
    };

    const byName = this.findRegistryManagerByName(registryState, registryLookupOptions);
    if (byName) {
      return byName;
    }

    const byMatch = this.findRegistryManagerByImageMatch(
      container,
      logContainer,
      registryState,
      registryLookupOptions,
    );
    if (byMatch) {
      return byMatch;
    }

    if (allowAnonymousFallback) {
      const anonymousRegistryManager = this.createAnonymousRegistryManager(container, logContainer);
      if (anonymousRegistryManager) {
        return anonymousRegistryManager;
      }
    }

    throw this.createUnsupportedRegistryManagerError(registryState, registryName);
  }
}

export default RegistryResolver;
