import TriggerPipelineError from './TriggerPipelineError.js';

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

  isRegistryManagerCompatible(registry, options: Record<string, any> = {}) {
    const { requireNormalizeImage = false } = options;
    if (!registry || typeof registry !== 'object') {
      return false;
    }
    if (typeof registry.getAuthPull !== 'function') {
      return false;
    }
    if (typeof registry.getImageFullName !== 'function') {
      return false;
    }
    if (requireNormalizeImage && typeof registry.normalizeImage !== 'function') {
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

  ensureCompatibleRegistryManager(registryManager, options: Record<string, any> = {}) {
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
    registryState: Record<string, any> = {},
    options: Record<string, any> = {},
  ) {
    const { registryName, requiredMethods = [], requireNormalizeImage = false } = options;

    return this.ensureCompatibleRegistryManager(registryState[registryName], {
      source: 'lookup by name',
      registryName,
      requiredMethods,
      requireNormalizeImage,
    });
  }

  findRegistryManagerByImageCandidate(registryState: Record<string, any> = {}, imageCandidate) {
    for (const registryManager of Object.values(registryState)) {
      if (typeof registryManager?.match !== 'function') {
        continue;
      }

      try {
        if (registryManager.match(imageCandidate)) {
          return registryManager;
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
    registryState: Record<string, any> = {},
    options: Record<string, any> = {},
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

  createUnsupportedRegistryManagerError(registryState: Record<string, any> = {}, registryName) {
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
    registryState: Record<string, any> = {},
    options: Record<string, any> = {},
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
