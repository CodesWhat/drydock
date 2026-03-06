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
    const requiredMethods = ['getAuthPull', 'getImageFullName'];
    if (requireNormalizeImage) {
      requiredMethods.push('normalizeImage');
    }

    const ensureCompatible = (registryManager, source) => {
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
    };

    const byName = ensureCompatible(registryState[registryName], 'lookup by name');
    if (byName) {
      return byName;
    }

    const lookupCandidates = this.buildRegistryLookupCandidates(container?.image);
    for (const imageCandidate of lookupCandidates) {
      const byMatch = Object.values(registryState).find((registryManager) => {
        if (typeof registryManager?.match !== 'function') {
          return false;
        }
        try {
          return registryManager.match(imageCandidate);
        } catch {
          return false;
        }
      });
      if (byMatch) {
        const byMatchCompatible = ensureCompatible(byMatch, 'lookup by image match');
        if (byMatchCompatible) {
          const matchedRegistryId =
            typeof byMatchCompatible.getId === 'function' ? byMatchCompatible.getId() : 'unknown';
          logContainer.debug?.(
            `Resolved registry manager "${registryName}" using matcher "${matchedRegistryId}"`,
          );
          return byMatchCompatible;
        }
      }
    }

    if (allowAnonymousFallback) {
      const anonymousRegistryManager = this.createAnonymousRegistryManager(container, logContainer);
      if (anonymousRegistryManager) {
        return anonymousRegistryManager;
      }
    }

    const knownRegistries = Object.keys(registryState);
    const knownRegistriesAsString =
      knownRegistries.length > 0 ? knownRegistries.join(', ') : 'none';
    throw new TriggerPipelineError(
      'registry-manager-unsupported',
      `Unsupported registry manager "${registryName}". Known registries: ${knownRegistriesAsString}. Configure a matching registry or provide a valid registry URL.`,
      {
        source: 'RegistryResolver',
      },
    );
  }
}

export default RegistryResolver;
