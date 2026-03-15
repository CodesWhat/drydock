import { asNonEmptyString, asRecord, asStringArray, uniqStrings } from './shared.js';
import type { RegistryWebhookReference } from './types.js';

function resolveTags(packageVersion: Record<string, unknown> | undefined): string[] {
  const metadata = asRecord(packageVersion?.metadata);
  const metadataContainer = asRecord(metadata?.container);
  const containerMetadata = asRecord(packageVersion?.container_metadata);
  const tagObject = asRecord(containerMetadata?.tag);

  return uniqStrings([
    ...asStringArray(metadataContainer?.tags),
    ...asStringArray(containerMetadata?.tags),
    ...asStringArray(tagObject?.tags),
    asNonEmptyString(tagObject?.name) || '',
  ]).filter((tag) => tag !== '');
}

function resolveImage(packageData: Record<string, unknown>): string | undefined {
  const imageName = asNonEmptyString(packageData.name);
  const namespace = asNonEmptyString(packageData.namespace);
  if (!imageName) {
    return undefined;
  }
  if (!namespace || imageName.startsWith(`${namespace}/`)) {
    return imageName;
  }
  return `${namespace}/${imageName}`;
}

export function parseGhcrWebhookPayload(payload: unknown): RegistryWebhookReference[] {
  const root = asRecord(payload);
  if (!root) {
    return [];
  }

  const registryPackage = asRecord(root.registry_package);
  if (!registryPackage) {
    return [];
  }

  const packageType = asNonEmptyString(registryPackage.package_type);
  if (packageType && packageType.toLowerCase() !== 'container') {
    return [];
  }

  const image = resolveImage(registryPackage);
  if (!image) {
    return [];
  }

  const packageVersion = asRecord(registryPackage.package_version);
  const tags = resolveTags(packageVersion);
  if (tags.length === 0) {
    return [];
  }

  return tags.map((tag) => ({ image, tag }));
}
