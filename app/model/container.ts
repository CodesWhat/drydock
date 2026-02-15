import { flatten as flat } from 'flat';
import joi from 'joi';
import { snakeCase } from 'snake-case';
import type {
  ContainerSecuritySbom,
  ContainerSecurityScan,
  ContainerSignatureVerification,
} from '../security/scan.js';
import * as tag from '../tag/index.js';

const { parse: parseSemver, diff: diffSemver, transform: transformTag } = tag;

export interface ContainerImage {
  id: string;
  registry: {
    name: string;
    url: string;
    lookupImage?: string;
    lookupUrl?: string;
  };
  name: string;
  tag: {
    value: string;
    semver: boolean;
  };
  digest: {
    watch: boolean;
    value?: string;
    repo?: string;
  };
  architecture: string;
  os: string;
  variant?: string;
  created?: string;
}

export interface ContainerResult {
  tag?: string;
  digest?: string;
  created?: string;
  link?: string;
}

export interface ContainerUpdateKind {
  kind: 'tag' | 'digest' | 'unknown';
  localValue?: string;
  remoteValue?: string;
  semverDiff?: 'major' | 'minor' | 'patch' | 'prerelease' | 'unknown';
}

export interface ContainerUpdatePolicy {
  skipTags?: string[];
  skipDigests?: string[];
  snoozeUntil?: string;
}

export interface ContainerSecurityState {
  scan?: ContainerSecurityScan;
  signature?: ContainerSignatureVerification;
  sbom?: ContainerSecuritySbom;
}

export interface Container {
  id: string;
  name: string;
  displayName: string;
  displayIcon: string;
  status: string;
  watcher: string;
  agent?: string;
  includeTags?: string;
  excludeTags?: string;
  transformTags?: string;
  linkTemplate?: string;
  link?: string;
  triggerInclude?: string;
  triggerExclude?: string;
  updatePolicy?: ContainerUpdatePolicy;
  security?: ContainerSecurityState;
  image: ContainerImage;
  result?: ContainerResult;
  error?: {
    message: string;
  };
  updateAvailable: boolean;
  updateKind: ContainerUpdateKind;
  labels?: Record<string, string>;
  resultChanged?: (otherContainer: Container | undefined) => boolean;
}

export interface ContainerReport {
  container: Container;
  changed: boolean;
}

// Container data schema
const schema = joi.object({
  id: joi.string().min(1).required(),
  name: joi.string().min(1).required(),
  displayName: joi.string().default(joi.ref('name')),
  displayIcon: joi.string().default('mdi:docker'),
  status: joi.string().default('unknown'),
  watcher: joi.string().min(1).required(),
  agent: joi.string().optional(),
  includeTags: joi.string(),
  excludeTags: joi.string(),
  transformTags: joi.string(),
  linkTemplate: joi.string(),
  link: joi.string(),
  triggerInclude: joi.string(),
  triggerExclude: joi.string(),
  updatePolicy: joi.object({
    skipTags: joi.array().items(joi.string()),
    skipDigests: joi.array().items(joi.string()),
    snoozeUntil: joi.string().isoDate(),
  }),
  security: joi.object({
    scan: joi.object({
      scanner: joi.string().valid('trivy').required(),
      image: joi.string().required(),
      scannedAt: joi.string().isoDate().required(),
      status: joi.string().valid('passed', 'blocked', 'error').required(),
      blockSeverities: joi
        .array()
        .items(joi.string().valid('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
        .required(),
      blockingCount: joi.number().integer().min(0).required(),
      summary: joi
        .object({
          unknown: joi.number().integer().min(0).required(),
          low: joi.number().integer().min(0).required(),
          medium: joi.number().integer().min(0).required(),
          high: joi.number().integer().min(0).required(),
          critical: joi.number().integer().min(0).required(),
        })
        .required(),
      vulnerabilities: joi
        .array()
        .items(
          joi.object({
            id: joi.string().required(),
            target: joi.string(),
            packageName: joi.string(),
            installedVersion: joi.string(),
            fixedVersion: joi.string(),
            severity: joi.string().valid('UNKNOWN', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'),
            title: joi.string(),
            primaryUrl: joi.string(),
          }),
        )
        .required(),
      error: joi.string(),
    }),
    signature: joi.object({
      verifier: joi.string().valid('cosign').required(),
      image: joi.string().required(),
      verifiedAt: joi.string().isoDate().required(),
      status: joi.string().valid('verified', 'unverified', 'error').required(),
      keyless: joi.boolean().required(),
      signatures: joi.number().integer().min(0).required(),
      error: joi.string(),
    }),
    sbom: joi.object({
      generator: joi.string().valid('trivy').required(),
      image: joi.string().required(),
      generatedAt: joi.string().isoDate().required(),
      status: joi.string().valid('generated', 'error').required(),
      formats: joi.array().items(joi.string().valid('spdx-json', 'cyclonedx-json')).required(),
      documents: joi.object().required(),
      error: joi.string(),
    }),
  }),
  image: joi
    .object({
      id: joi.string().min(1).required(),
      registry: joi
        .object({
          name: joi.string().min(1).required(),
          url: joi.string().min(1).required(),
          lookupImage: joi.string(),
          lookupUrl: joi.string(),
        })
        .required(),
      name: joi.string().min(1).required(),
      tag: joi
        .object({
          value: joi.string().min(1).required(),
          semver: joi.boolean().default(false),
        })
        .required(),
      digest: joi
        .object({
          watch: joi.boolean().default(false),
          value: joi.string(),
          repo: joi.string(),
        })
        .required(),
      architecture: joi.string().min(1).required(),
      os: joi.string().min(1).required(),
      variant: joi.string(),
      created: joi.string().isoDate(),
    })
    .required(),
  result: joi.object({
    tag: joi.string().min(1),
    digest: joi.string(),
    created: joi.string().isoDate(),
    link: joi.string(),
  }),
  error: joi.object({
    message: joi.string().min(1).required(),
  }),
  updateAvailable: joi.boolean().default(false),
  updateKind: joi
    .object({
      kind: joi.string().allow('tag', 'digest', 'unknown').required(),
      localValue: joi.string(),
      remoteValue: joi.string(),
      semverDiff: joi.string().allow('major', 'minor', 'patch', 'prerelease', 'unknown'),
    })
    .default({ kind: 'unknown' }),
  resultChanged: joi.function(),
  labels: joi.object(),
});

function getRawTagUpdate(container: Container): ContainerUpdateKind {
  const updateKind: ContainerUpdateKind = {
    kind: 'unknown',
    localValue: undefined,
    remoteValue: undefined,
    semverDiff: 'unknown',
  };
  if (!container.image || !container.result) {
    return updateKind;
  }
  if (container.image.tag?.value === undefined || container.result.tag === undefined) {
    return updateKind;
  }

  let hasTagOrCreatedUpdate = false;
  let hasTagUpdate = false;
  const localTag = transformTag(container.transformTags, container.image.tag.value);
  const remoteTag = transformTag(container.transformTags, container.result.tag);
  hasTagUpdate = localTag !== remoteTag;
  hasTagOrCreatedUpdate = hasTagUpdate;

  // Fallback to image created date (especially for legacy v1 manifests)
  if (container.image.created !== undefined && container.result.created !== undefined) {
    const createdDate = new Date(container.image.created).getTime();
    const createdDateResult = new Date(container.result.created).getTime();
    hasTagOrCreatedUpdate = hasTagOrCreatedUpdate || createdDate !== createdDateResult;
  }

  if (!hasTagOrCreatedUpdate) {
    return updateKind;
  }
  if (!hasTagUpdate) {
    // Created-date-only updates are considered updates, but they do not
    // carry a stable remote value to be skipped as a specific version.
    return updateKind;
  }

  let semverDiffResult: ContainerUpdateKind['semverDiff'] = 'unknown';
  const isSemver = container.image.tag.semver;
  if (isSemver) {
    const semverDiff = diffSemver(
      transformTag(container.transformTags, container.image.tag.value),
      transformTag(container.transformTags, container.result.tag),
    );
    switch (semverDiff) {
      case 'major':
      case 'premajor':
        semverDiffResult = 'major';
        break;
      case 'minor':
      case 'preminor':
        semverDiffResult = 'minor';
        break;
      case 'patch':
      case 'prepatch':
        semverDiffResult = 'patch';
        break;
      case 'prerelease':
        semverDiffResult = 'prerelease';
        break;
      default:
        break;
    }
  }

  return {
    kind: 'tag',
    localValue: container.image.tag.value,
    remoteValue: container.result.tag,
    semverDiff: semverDiffResult,
  };
}

function getRawDigestUpdate(container: Container): ContainerUpdateKind {
  const updateKind: ContainerUpdateKind = {
    kind: 'unknown',
    localValue: undefined,
    remoteValue: undefined,
    semverDiff: 'unknown',
  };
  if (!container.image || !container.result) {
    return updateKind;
  }
  if (
    container.image.digest?.watch &&
    container.image.digest.value !== undefined &&
    container.result.digest !== undefined &&
    container.image.digest.value !== container.result.digest
  ) {
    return {
      kind: 'digest',
      localValue: container.image.digest.value,
      remoteValue: container.result.digest,
      semverDiff: 'unknown',
    };
  }
  return updateKind;
}

function getRawUpdateKind(container: Container): ContainerUpdateKind {
  const unknownUpdateKind: ContainerUpdateKind = {
    kind: 'unknown',
    localValue: undefined,
    remoteValue: undefined,
    semverDiff: 'unknown',
  };
  if (!container.image || !container.result) {
    return unknownUpdateKind;
  }

  // Digest watch mode takes precedence over tag-based updates.
  if (
    container.image.digest?.watch &&
    container.image.digest.value !== undefined &&
    container.result.digest !== undefined
  ) {
    return getRawDigestUpdate(container);
  }
  return getRawTagUpdate(container);
}

function hasRawUpdate(container: Container): boolean {
  if (!container.image || !container.result) {
    return false;
  }

  if (
    container.image.digest?.watch &&
    container.image.digest.value !== undefined &&
    container.result.digest !== undefined
  ) {
    return container.image.digest.value !== container.result.digest;
  }

  const localTag = transformTag(container.transformTags, container.image.tag.value);
  const remoteTag = transformTag(container.transformTags, container.result.tag);
  let updateAvailable = localTag !== remoteTag;

  // Fallback to image created date (especially for legacy v1 manifests)
  if (container.image.created !== undefined && container.result.created !== undefined) {
    const createdDate = new Date(container.image.created).getTime();
    const createdDateResult = new Date(container.result.created).getTime();

    updateAvailable = updateAvailable || createdDate !== createdDateResult;
  }
  return updateAvailable;
}

function isUpdateSuppressed(container: Container, updateKind: ContainerUpdateKind): boolean {
  const updatePolicy = container.updatePolicy;
  if (!updatePolicy) {
    return false;
  }

  if (updatePolicy.snoozeUntil) {
    const snoozeUntilDate = new Date(updatePolicy.snoozeUntil);
    if (!Number.isNaN(snoozeUntilDate.getTime()) && snoozeUntilDate.getTime() > Date.now()) {
      return true;
    }
  }

  if (updateKind.kind === 'tag' && updateKind.remoteValue && Array.isArray(updatePolicy.skipTags)) {
    return updatePolicy.skipTags.includes(updateKind.remoteValue);
  }

  if (
    updateKind.kind === 'digest' &&
    updateKind.remoteValue &&
    Array.isArray(updatePolicy.skipDigests)
  ) {
    return updatePolicy.skipDigests.includes(updateKind.remoteValue);
  }

  return false;
}

/**
 * Render Link template.
 * @param container
 * @returns {undefined|*}
 */
function getLink(container: Container, originalTagValue: string) {
  if (!container?.linkTemplate) {
    return undefined;
  }

  const vars: Record<string, string> = {};
  vars.raw = originalTagValue; // deprecated, kept for backward compatibility
  vars.original = originalTagValue;
  vars.transformed = container.transformTags
    ? transformTag(container.transformTags, originalTagValue)
    : originalTagValue;
  vars.major = '';
  vars.minor = '';
  vars.patch = '';
  vars.prerelease = '';

  if (container.image.tag.semver) {
    const versionSemver = parseSemver(vars.transformed);
    if (versionSemver) {
      vars.major = String(versionSemver.major);
      vars.minor = String(versionSemver.minor);
      vars.patch = String(versionSemver.patch);
      vars.prerelease =
        versionSemver.prerelease && versionSemver.prerelease.length > 0
          ? String(versionSemver.prerelease[0])
          : '';
    }
  }
  return container.linkTemplate.replaceAll(/\$\{(\w+)\}/g, (_, key) =>
    key in vars ? vars[key] : '',
  );
}

/**
 * Computed function to check whether there is an update.
 * @param container
 * @returns {boolean}
 */
function addUpdateAvailableProperty(container: Container) {
  Object.defineProperty(container, 'updateAvailable', {
    enumerable: true,
    get(this: Container) {
      if (!hasRawUpdate(this)) {
        return false;
      }
      const updateKind = getRawUpdateKind(this);
      return !isUpdateSuppressed(this, updateKind);
    },
  });
}

/**
 * Computed link property.
 * @param container
 * @returns {undefined|*}
 */
function addLinkProperty(container: Container) {
  if (container.linkTemplate) {
    Object.defineProperty(container, 'link', {
      enumerable: true,
      get(this: Container) {
        return getLink(container, container.image.tag.value);
      },
    });

    if (container.result) {
      Object.defineProperty(container.result, 'link', {
        enumerable: true,
        get() {
          return getLink(container, container.result.tag ?? '');
        },
      });
    }
  }
}

/**
 * Computed updateKind property.
 * @param container
 * @returns {{semverDiff: undefined, kind: string, remoteValue: undefined, localValue: undefined}}
 */
function addUpdateKindProperty(container: Container) {
  Object.defineProperty(container, 'updateKind', {
    enumerable: true,
    get(this: Container) {
      return getRawUpdateKind(this);
    },
  });
}

/**
 * Computed function to check whether the result is different.
 * @param otherContainer
 * @returns {boolean}
 */
function resultChangedFunction(this: Container, otherContainer: Container | undefined) {
  return (
    otherContainer === undefined ||
    this.result?.tag !== otherContainer.result?.tag ||
    this.result?.digest !== otherContainer.result?.digest ||
    this.result?.created !== otherContainer.result?.created
  );
}

/**
 * Add computed function to check whether the result is different.
 * @param container
 * @returns {*}
 */
function addResultChangedFunction(container: Container) {
  const containerWithResultChanged = container;
  containerWithResultChanged.resultChanged = resultChangedFunction;
  return containerWithResultChanged;
}

/**
 * Apply validation to the container object.
 * @param container
 * @returns {*}
 */
export function validate(container: any): Container {
  const validation = schema.validate(container);
  if (validation.error) {
    throw new Error(`Error when validating container properties ${validation.error}`);
  }
  const containerValidated = validation.value as Container;

  // Backward compatibility: old experimental branches persisted lookupUrl.
  if (
    containerValidated.image?.registry?.lookupImage === undefined &&
    containerValidated.image?.registry?.lookupUrl !== undefined
  ) {
    containerValidated.image.registry.lookupImage = containerValidated.image.registry.lookupUrl;
  }
  delete containerValidated.image?.registry?.lookupUrl;

  // Add computed properties
  addUpdateAvailableProperty(containerValidated);
  addUpdateKindProperty(containerValidated);
  addLinkProperty(containerValidated);

  // Add computed functions
  addResultChangedFunction(containerValidated);
  return containerValidated;
}

/**
 * Flatten the container object (useful for k/v based integrations).
 * @param container
 * @returns {*}
 */
export function flatten(container: Container) {
  const containerFlatten: any = flat(container, {
    delimiter: '_',
    transformKey: (key: string) => snakeCase(key),
  });
  delete containerFlatten.result_changed;
  return containerFlatten;
}

/**
 * Build the business id of the container.
 * @param container
 * @returns {string}
 */
export function fullName(container: Container) {
  return `${container.watcher}_${container.name}`;
}

// The following exports are meant for testing only
export {
  getLink as testable_getLink,
  addUpdateKindProperty as testable_addUpdateKindProperty,
  addLinkProperty as testable_addLinkProperty,
  getRawTagUpdate as testable_getRawTagUpdate,
  getRawDigestUpdate as testable_getRawDigestUpdate,
};
