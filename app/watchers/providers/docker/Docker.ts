import fs from 'fs';
import Dockerode from 'dockerode';
import axios from 'axios';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';
const joi = JoiCronExpression(Joi);
import cron from 'node-cron';
import parse from 'parse-docker-image-name';
import debounceImport from 'just-debounce';
const debounce: typeof import('just-debounce').default =
    (debounceImport as any).default || (debounceImport as any);
import {
    parse as parseSemver,
    isGreater as isGreaterSemver,
    transform as transformTag,
} from '../../../tag/index.js';
import * as event from '../../../event/index.js';
import {
    wudWatch,
    wudTagInclude,
    wudTagExclude,
    wudTagTransform,
    wudInspectTagPath,
    wudRegistryLookupImage,
    wudRegistryLookupUrl,
    wudWatchDigest,
    wudLinkTemplate,
    wudDisplayName,
    wudDisplayIcon,
    wudTriggerInclude,
    wudTriggerExclude,
} from './label.js';
import * as storeContainer from '../../../store/container.js';
import log from '../../../log/index.js';
import {
    validate as validateContainer,
    fullName,
    Container,
    ContainerImage,
} from '../../../model/container.js';
import * as registry from '../../../registry/index.js';
import { getWatchContainerGauge } from '../../../prometheus/watcher.js';
import Watcher from '../../Watcher.js';
import { ComponentConfiguration } from '../../../registry/Component.js';

export interface DockerWatcherConfiguration extends ComponentConfiguration {
    socket: string;
    host?: string;
    protocol?: 'http' | 'https' | 'ssh';
    port: number;
    auth?: {
        type?: 'basic' | 'bearer' | 'oidc';
        user?: string;
        password?: string;
        bearer?: string;
        oidc?: any;
    };
    cafile?: string;
    certfile?: string;
    keyfile?: string;
    cron: string;
    jitter: number;
    watchbydefault: boolean;
    watchall: boolean;
    watchdigest?: any;
    watchevents: boolean;
    watchatstart: boolean;
    imgset?: Record<string, any>;
}

// The delay before starting the watcher when the app is started
const START_WATCHER_DELAY_MS = 1000;

// Debounce delay used when performing a watch after a docker event has been received
const DEBOUNCED_WATCH_CRON_MS = 5000;
const SWARM_SERVICE_ID_LABEL = 'com.docker.swarm.service.id';
const OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS = 30 * 1000;
const OIDC_DEFAULT_ACCESS_TOKEN_TTL_MS = 5 * 60 * 1000;
const OIDC_DEFAULT_TIMEOUT_MS = 5000;
const OIDC_TOKEN_ENDPOINT_PATHS = [
    'tokenurl',
    'tokenendpoint',
    'token_url',
    'token_endpoint',
    'token.url',
    'token.endpoint',
];
const OIDC_CLIENT_ID_PATHS = ['clientid', 'client_id', 'client.id'];
const OIDC_CLIENT_SECRET_PATHS = [
    'clientsecret',
    'client_secret',
    'client.secret',
];
const OIDC_SCOPE_PATHS = ['scope'];
const OIDC_RESOURCE_PATHS = ['resource'];
const OIDC_AUDIENCE_PATHS = ['audience'];
const OIDC_GRANT_TYPE_PATHS = ['granttype', 'grant_type'];
const OIDC_ACCESS_TOKEN_PATHS = ['accesstoken', 'access_token'];
const OIDC_REFRESH_TOKEN_PATHS = ['refreshtoken', 'refresh_token'];
const OIDC_EXPIRES_IN_PATHS = ['expiresin', 'expires_in'];
const OIDC_TIMEOUT_PATHS = ['timeout'];

interface ResolvedImgset {
    name: string;
    includeTags?: string;
    excludeTags?: string;
    transformTags?: string;
    linkTemplate?: string;
    displayName?: string;
    displayIcon?: string;
    triggerInclude?: string;
    triggerExclude?: string;
    registryLookupImage?: string;
    registryLookupUrl?: string;
}

/**
 * Return all supported registries
 * @returns {*}
 */
function getRegistries() {
    return registry.getState().registry;
}

/**
 * Filter candidate tags (based on tag name).
 * @param container
 * @param tags
 * @returns {*}
 */
function getTagCandidates(
    container: Container,
    tags: string[],
    logContainer: any,
) {
    let filteredTags = tags;
    let allowIncludeFilterRecovery = false;

    // Match include tag regex
    if (container.includeTags) {
        const includeTagsRegex = new RegExp(container.includeTags);
        filteredTags = filteredTags.filter((tag) => includeTagsRegex.test(tag));
        // If current semver tag falls outside include filter, still attempt to
        // move toward the include-filtered semver stream.
        if (
            container.image.tag.semver &&
            !includeTagsRegex.test(container.image.tag.value)
        ) {
            logContainer.warn(
                `Current tag "${container.image.tag.value}" does not match includeTags regex "${container.includeTags}". Trying best-effort semver upgrade within filtered tags.`,
            );
            allowIncludeFilterRecovery = true;
        }
    } else {
        // If no includeTags, filter out tags starting with "sha"
        filteredTags = filteredTags.filter((tag) => !tag.startsWith('sha'));
    }

    // Match exclude tag regex
    if (container.excludeTags) {
        const excludeTagsRegex = new RegExp(container.excludeTags);
        filteredTags = filteredTags.filter(
            (tag) => !excludeTagsRegex.test(tag),
        );
    }

    // Always filter out tags ending with ".sig"
    filteredTags = filteredTags.filter((tag) => !tag.endsWith('.sig'));

    // Semver image -> find higher semver tag
    if (container.image.tag.semver) {
        if (filteredTags.length === 0) {
            logContainer.warn(
                'No tags found after filtering; check you regex filters',
            );
        }

        // If user has not specified custom include regex, default to keep current prefix
        // Prefix is almost-always standardised around "must stay the same" for tags
        if (!container.includeTags) {
            const currentTag = container.image.tag.value;
            const match = currentTag.match(/^(.*?)(\d+.*)$/);
            const currentPrefix = match ? match[1] : '';

            if (currentPrefix) {
                // Retain only tags with the same non-empty prefix
                filteredTags = filteredTags.filter((tag) =>
                    tag.startsWith(currentPrefix),
                );
            } else {
                // Retain only tags that start with a number (no prefix)
                filteredTags = filteredTags.filter((tag) => /^\d/.test(tag));
            }

            // Ensure we throw good errors when we've prefix-related issues
            if (filteredTags.length === 0) {
                if (currentPrefix) {
                    logContainer.warn(
                        "No tags found with existing prefix: '" +
                            currentPrefix +
                            "'; check your regex filters",
                    );
                } else {
                    logContainer.warn(
                        'No tags found starting with a number (no prefix); check your regex filters',
                    );
                }
            }
        }

        // Keep semver only
        filteredTags = filteredTags.filter(
            (tag) =>
                parseSemver(transformTag(container.transformTags, tag)) !==
                null,
        );

        // Remove prefix and suffix (keep only digits and dots)
        const numericPart = transformTag(
            container.transformTags,
            container.image.tag.value,
        ).match(/(\d+(\.\d+)*)/);

        if (numericPart) {
            const referenceGroups = numericPart[0].split('.').length;

            filteredTags = filteredTags.filter((tag) => {
                const tagNumericPart = transformTag(
                    container.transformTags,
                    tag,
                ).match(/(\d+(\.\d+)*)/);
                if (!tagNumericPart) return false; // skip tags without numeric part
                const tagGroups = tagNumericPart[0].split('.').length;

                // Keep only tags with the same number of numeric segments
                return tagGroups === referenceGroups;
            });
        }

        // Keep only greater semver unless we are recovering from an include-filter
        // mismatch on current tag, in which case we keep best matching semver.
        if (!allowIncludeFilterRecovery) {
            filteredTags = filteredTags.filter((tag) =>
                isGreaterSemver(
                    transformTag(container.transformTags, tag),
                    transformTag(
                        container.transformTags,
                        container.image.tag.value,
                    ),
                ),
            );
        }

        // Apply semver sort desc
        filteredTags.sort((t1, t2) => {
            const greater = isGreaterSemver(
                transformTag(container.transformTags, t2),
                transformTag(container.transformTags, t1),
            );
            return greater ? 1 : -1;
        });
    } else {
        // Non semver tag -> do not propose any other registry tag
        filteredTags = [];
    }
    return filteredTags;
}

function normalizeContainer(container: Container) {
    const containerWithNormalizedImage = container;
    const imageForMatching = getImageForRegistryLookup(container.image);
    const registryProvider = Object.values(getRegistries()).find((provider) =>
        provider.match(imageForMatching),
    );
    if (!registryProvider) {
        log.warn(`${fullName(container)} - No Registry Provider found`);
        containerWithNormalizedImage.image.registry.name = 'unknown';
    } else {
        containerWithNormalizedImage.image = registryProvider.normalizeImage(
            imageForMatching,
        );
        containerWithNormalizedImage.image.registry.name =
            registryProvider.getId();
    }
    return validateContainer(containerWithNormalizedImage);
}

/**
 * Build an image candidate used for registry matching and tag lookups.
 * The lookup value can be:
 * - an image reference (preferred): ghcr.io/user/image or library/nginx
 * - a legacy registry url: https://registry-1.docker.io
 */
function getImageForRegistryLookup(image: ContainerImage) {
    const lookupImage =
        image.registry.lookupImage || image.registry.lookupUrl || '';
    const lookupImageTrimmed = lookupImage.trim();
    if (lookupImageTrimmed === '') {
        return image;
    }

    // Legacy fallback: support plain registry URL values from older experiments.
    if (/^https?:\/\//i.test(lookupImageTrimmed)) {
        try {
            const lookupUrl = new URL(lookupImageTrimmed).hostname;
            return {
                ...image,
                registry: {
                    ...image.registry,
                    url: lookupUrl,
                },
            };
        } catch (e) {
            return image;
        }
    }

    const parsedLookupImage = parse(lookupImageTrimmed);
    const parsedPath = parsedLookupImage.path;
    const parsedDomain = parsedLookupImage.domain;

    // If only a registry hostname was provided, keep the original image name.
    if (parsedPath && !parsedDomain && !lookupImageTrimmed.includes('/')) {
        return {
            ...image,
            registry: {
                ...image.registry,
                url: parsedPath,
            },
        };
    }

    if (!parsedPath) {
        return image;
    }

    return {
        ...image,
        registry: {
            ...image.registry,
            url: parsedDomain || 'registry-1.docker.io',
        },
        name: parsedPath,
    };
}

/**
 * Get the Docker Registry by name.
 * @param registryName
 */
function getRegistry(registryName: string) {
    const registryToReturn = getRegistries()[registryName];
    if (!registryToReturn) {
        throw new Error(`Unsupported Registry ${registryName}`);
    }
    return registryToReturn;
}

/**
 * Get old containers to prune.
 * @param newContainers
 * @param containersFromTheStore
 * @returns {*[]|*}
 */
function getOldContainers(
    newContainers: Container[],
    containersFromTheStore: Container[],
) {
    if (!containersFromTheStore || !newContainers) {
        return [];
    }
    return containersFromTheStore.filter((containerFromStore) => {
        const isContainerStillToWatch = newContainers.find(
            (newContainer) => newContainer.id === containerFromStore.id,
        );
        return isContainerStillToWatch === undefined;
    });
}

/**
 * Prune old containers from the store.
 * @param newContainers
 * @param containersFromTheStore
 */
function pruneOldContainers(
    newContainers: Container[],
    containersFromTheStore: Container[],
) {
    const containersToRemove = getOldContainers(
        newContainers,
        containersFromTheStore,
    );
    containersToRemove.forEach((containerToRemove) => {
        storeContainer.deleteContainer(containerToRemove.id);
    });
}

function getContainerName(container: any) {
    let containerName = '';
    const names = container.Names;
    if (names && names.length > 0) {
        [containerName] = names;
    }
    // Strip ugly forward slash
    containerName = containerName.replace(/\//, '');
    return containerName;
}

function getContainerDisplayName(
    containerName: string,
    parsedImagePath: string,
    displayName?: string,
) {
    if (displayName && displayName.trim() !== '') {
        return displayName;
    }

    const normalizedImagePath = (parsedImagePath || '').toLowerCase();
    if (
        normalizedImagePath === 'whatsupdocker-ce' ||
        normalizedImagePath.endsWith('/whatsupdocker-ce')
    ) {
        return 'wud-ce';
    }

    return containerName;
}

function normalizeConfigStringValue(value: any) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const valueTrimmed = value.trim();
    return valueTrimmed === '' ? undefined : valueTrimmed;
}

function getNestedValue(value: any, path: string) {
    return path
        .split('.')
        .filter((item) => item !== '')
        .reduce((nestedValue, item) => {
            if (
                nestedValue === undefined ||
                nestedValue === null ||
                typeof nestedValue !== 'object'
            ) {
                return undefined;
            }
            return nestedValue[item];
        }, value);
}

function getFirstConfigString(value: any, paths: string[]) {
    for (const path of paths) {
        const pathValue = normalizeConfigStringValue(getNestedValue(value, path));
        if (pathValue !== undefined) {
            return pathValue;
        }
    }
    return undefined;
}

function getImageReferenceCandidates(path: string, domain?: string) {
    const pathNormalized = normalizeConfigStringValue(path)?.toLowerCase();
    if (!pathNormalized) {
        return [];
    }
    const domainNormalized = normalizeConfigStringValue(domain)?.toLowerCase();
    const pathWithoutLibraryPrefix = pathNormalized.startsWith('library/')
        ? pathNormalized.substring('library/'.length)
        : pathNormalized;
    const candidates = new Set<string>([
        pathNormalized,
        pathWithoutLibraryPrefix,
        `docker.io/${pathNormalized}`,
        `docker.io/${pathWithoutLibraryPrefix}`,
        `registry-1.docker.io/${pathNormalized}`,
        `registry-1.docker.io/${pathWithoutLibraryPrefix}`,
    ]);
    if (domainNormalized) {
        candidates.add(`${domainNormalized}/${pathNormalized}`);
        candidates.add(`${domainNormalized}/${pathWithoutLibraryPrefix}`);
    }
    return Array.from(candidates).filter((candidate) => candidate !== '');
}

function getImageReferenceCandidatesFromPattern(pattern: string) {
    const patternNormalized = normalizeConfigStringValue(pattern);
    if (!patternNormalized) {
        return [];
    }
    try {
        const parsedPattern = parse(patternNormalized.toLowerCase());
        if (!parsedPattern.path) {
            return [patternNormalized.toLowerCase()];
        }
        return getImageReferenceCandidates(
            parsedPattern.path,
            parsedPattern.domain,
        );
    } catch (e) {
        return [patternNormalized.toLowerCase()];
    }
}

function getImageReferenceCandidatesFromParsedImage(parsedImage: any) {
    return getImageReferenceCandidates(parsedImage?.path, parsedImage?.domain);
}

function getImgsetSpecificity(imagePattern: string, parsedImage: any) {
    const patternCandidates = getImageReferenceCandidatesFromPattern(imagePattern);
    if (patternCandidates.length === 0) {
        return -1;
    }
    const imageCandidates = getImageReferenceCandidatesFromParsedImage(parsedImage);
    if (imageCandidates.length === 0) {
        return -1;
    }

    const hasMatch = patternCandidates.some((patternCandidate) =>
        imageCandidates.includes(patternCandidate),
    );
    if (!hasMatch) {
        return -1;
    }
    return patternCandidates.reduce(
        (maxSpecificity, patternCandidate) =>
            Math.max(maxSpecificity, patternCandidate.length),
        0,
    );
}

function getResolvedImgsetConfiguration(name: string, imgsetConfiguration: any) {
    return {
        name,
        includeTags: getFirstConfigString(imgsetConfiguration, [
            'tag.include',
            'includeTags',
            'include',
        ]),
        excludeTags: getFirstConfigString(imgsetConfiguration, [
            'tag.exclude',
            'excludeTags',
            'exclude',
        ]),
        transformTags: getFirstConfigString(imgsetConfiguration, [
            'tag.transform',
            'transformTags',
            'transform',
        ]),
        linkTemplate: getFirstConfigString(imgsetConfiguration, [
            'link.template',
            'linkTemplate',
        ]),
        displayName: getFirstConfigString(imgsetConfiguration, [
            'display.name',
            'displayName',
        ]),
        displayIcon: getFirstConfigString(imgsetConfiguration, [
            'display.icon',
            'displayIcon',
        ]),
        triggerInclude: getFirstConfigString(imgsetConfiguration, [
            'trigger.include',
            'triggerInclude',
        ]),
        triggerExclude: getFirstConfigString(imgsetConfiguration, [
            'trigger.exclude',
            'triggerExclude',
        ]),
        registryLookupImage: getFirstConfigString(imgsetConfiguration, [
            'registry.lookup.image',
            'registryLookupImage',
            'lookupImage',
        ]),
        registryLookupUrl: getFirstConfigString(imgsetConfiguration, [
            'registry.lookup.url',
            'registryLookupUrl',
            'lookupUrl',
        ]),
    } as ResolvedImgset;
}

function getContainerConfigValue(
    labelValue: string | undefined,
    imgsetValue: string | undefined,
) {
    return (
        normalizeConfigStringValue(labelValue) ||
        normalizeConfigStringValue(imgsetValue)
    );
}

function normalizeConfigNumberValue(value: any) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsedNumber = Number(value);
        if (Number.isFinite(parsedNumber)) {
            return parsedNumber;
        }
    }
    return undefined;
}

function getFirstConfigNumber(value: any, paths: string[]) {
    for (const path of paths) {
        const pathValue = normalizeConfigNumberValue(getNestedValue(value, path));
        if (pathValue !== undefined) {
            return pathValue;
        }
    }
    return undefined;
}

/**
 * Get image repo digest.
 * @param containerImage
 * @returns {*} digest
 */
function getRepoDigest(containerImage: any) {
    if (
        !containerImage.RepoDigests ||
        containerImage.RepoDigests.length === 0
    ) {
        return undefined;
    }
    const fullDigest = containerImage.RepoDigests[0];
    const digestSplit = fullDigest.split('@');
    return digestSplit[1];
}

/**
 * Resolve a value in a Docker inspect payload from a slash-separated path.
 * Example: Config/Labels/org.opencontainers.image.version
 */
function getInspectValueByPath(containerInspect: any, path: string) {
    if (!path) {
        return undefined;
    }
    const pathSegments = path.split('/').filter((segment) => segment !== '');
    return pathSegments.reduce((value, key) => {
        if (value === undefined || value === null) {
            return undefined;
        }
        return value[key];
    }, containerInspect);
}

/**
 * Try to derive a semver tag from a Docker inspect path.
 */
function getSemverTagFromInspectPath(
    containerInspect: any,
    inspectPath: string,
    transformTags: string,
) {
    const inspectValue = getInspectValueByPath(containerInspect, inspectPath);
    if (inspectValue === undefined || inspectValue === null) {
        return undefined;
    }
    const tagValue = `${inspectValue}`.trim();
    if (tagValue === '') {
        return undefined;
    }
    const parsedTag = parseSemver(transformTag(transformTags, tagValue));
    return parsedTag?.version;
}

/**
 * Return true if container must be watched.
 * @param wudWatchLabelValue the value of the wud.watch label
 * @param watchByDefault true if containers must be watched by default
 * @returns {boolean}
 */
function isContainerToWatch(
    wudWatchLabelValue: string,
    watchByDefault: boolean,
) {
    return wudWatchLabelValue !== undefined && wudWatchLabelValue !== ''
        ? wudWatchLabelValue.toLowerCase() === 'true'
        : watchByDefault;
}

/**
 * Return true if container digest must be watched.
 * @param {string} wudWatchDigestLabelValue - the value of wud.watch.digest label
 * @param {object} parsedImage - object containing at least `domain` property
 * @param {boolean} isSemver - true if the current image tag is a semver tag
 * @returns {boolean}
 */
function isDigestToWatch(
    wudWatchDigestLabelValue: string,
    parsedImage: any,
    isSemver: boolean,
) {
    const domain = parsedImage.domain;
    const isDockerHub =
        !domain ||
        domain === '' ||
        domain === 'docker.io' ||
        domain.endsWith('.docker.io');

    if (
        wudWatchDigestLabelValue !== undefined &&
        wudWatchDigestLabelValue !== ''
    ) {
        const shouldWatch = wudWatchDigestLabelValue.toLowerCase() === 'true';
        if (shouldWatch && isDockerHub) {
            log.warn(
                `Watching digest for image ${parsedImage.path} with domain ${domain} may result in throttled requests`,
            );
        }
        return shouldWatch;
    }

    if (isSemver) {
        return false;
    }

    return !isDockerHub;
}

/**
 * Docker Watcher Component.
 */
class Docker extends Watcher {
    public configuration: DockerWatcherConfiguration =
        {} as DockerWatcherConfiguration;
    public dockerApi: Dockerode;
    public watchCron: any;
    public watchCronTimeout: any;
    public watchCronDebounced: any;
    public listenDockerEventsTimeout: any;
    public dockerEventsBuffer = '';
    public remoteOidcAccessToken?: string;
    public remoteOidcRefreshToken?: string;
    public remoteOidcAccessTokenExpiresAt?: number;

    ensureLogger() {
        if (!this.log) {
            try {
                this.log = log.child({
                    component: `watcher.docker.${this.name || 'default'}`,
                });
            } catch (error) {
                // Fallback to silent logger if log module fails
                this.log = {
                    // @ts-ignore Unused implementation
                    info: () => {},
                    // @ts-ignore Unused implementation
                    warn: () => {},
                    // @ts-ignore Unused implementation
                    error: () => {},
                    // @ts-ignore Unused implementation
                    debug: () => {},
                    child: () => this.log,
                };
            }
        }
    }

    getConfigurationSchema() {
        return joi.object().keys({
            socket: this.joi.string().default('/var/run/docker.sock'),
            host: this.joi.string(),
            protocol: this.joi.string().valid('http', 'https'),
            port: this.joi.number().port().default(2375),
            auth: this.joi.object({
                type: this.joi
                    .string()
                    .valid('basic', 'bearer', 'oidc')
                    .insensitive(),
                user: this.joi.string(),
                password: this.joi.string(),
                bearer: this.joi.string(),
                oidc: this.joi.object().unknown(true),
            }),
            cafile: this.joi.string(),
            certfile: this.joi.string(),
            keyfile: this.joi.string(),
            cron: joi.string().cron().default('0 * * * *'),
            jitter: this.joi.number().integer().min(0).default(60000),
            watchbydefault: this.joi.boolean().default(true),
            watchall: this.joi.boolean().default(false),
            watchdigest: this.joi.any(),
            watchevents: this.joi.boolean().default(true),
            watchatstart: this.joi.boolean().default(true),
            imgset: this.joi
                .object()
                .pattern(
                    this.joi.string(),
                    this.joi.object({
                        image: this.joi.string().required(),
                        include: this.joi.string(),
                        exclude: this.joi.string(),
                        transform: this.joi.string(),
                        tag: this.joi.object({
                            include: this.joi.string(),
                            exclude: this.joi.string(),
                            transform: this.joi.string(),
                        }),
                        link: this.joi.object({
                            template: this.joi.string(),
                        }),
                        display: this.joi.object({
                            name: this.joi.string(),
                            icon: this.joi.string(),
                        }),
                        trigger: this.joi.object({
                            include: this.joi.string(),
                            exclude: this.joi.string(),
                        }),
                        registry: this.joi.object({
                            lookup: this.joi.object({
                                image: this.joi.string(),
                                url: this.joi.string(),
                            }),
                        }),
                    }),
                )
                .default({}),
        });
    }

    maskConfiguration() {
        return {
            ...this.configuration,
            auth: this.configuration.auth
                ? {
                      type: this.configuration.auth.type,
                      user: Docker.mask(this.configuration.auth.user),
                      password: Docker.mask(this.configuration.auth.password),
                      bearer: Docker.mask(this.configuration.auth.bearer),
                      oidc: this.configuration.auth.oidc
                          ? {
                                ...this.configuration.auth.oidc,
                                clientsecret: Docker.mask(
                                    getFirstConfigString(
                                        this.configuration.auth.oidc,
                                        ['clientsecret'],
                                    ),
                                ),
                                accesstoken: Docker.mask(
                                    getFirstConfigString(
                                        this.configuration.auth.oidc,
                                        ['accesstoken'],
                                    ),
                                ),
                                refreshtoken: Docker.mask(
                                    getFirstConfigString(
                                        this.configuration.auth.oidc,
                                        ['refreshtoken'],
                                    ),
                                ),
                            }
                          : undefined,
                  }
                : undefined,
        };
    }

    /**
     * Init the Watcher.
     */
    async init() {
        this.ensureLogger();
        this.initWatcher();
        if (this.configuration.watchdigest !== undefined) {
            this.log.warn(
                "WUD_WATCHER_{watcher_name}_WATCHDIGEST environment variable is deprecated and won't be supported in upcoming versions",
            );
        }
        this.log.info(`Cron scheduled (${this.configuration.cron})`);
        this.watchCron = cron.schedule(
            this.configuration.cron,
            () => this.watchFromCron(),
            { maxRandomDelay: this.configuration.jitter },
        );

        // Resolve watchatstart based on this watcher persisted state.
        // Keep explicit "false" untouched; default "true" is disabled only when
        // this watcher already has containers in store.
        const isWatcherStoreEmpty =
            storeContainer.getContainers({
                watcher: this.name,
            }).length === 0;
        this.configuration.watchatstart =
            this.configuration.watchatstart && isWatcherStoreEmpty;

        // watch at startup if enabled (after all components have been registered)
        if (this.configuration.watchatstart) {
            this.watchCronTimeout = setTimeout(
                this.watchFromCron.bind(this),
                START_WATCHER_DELAY_MS,
            );
        }

        // listen to docker events
        if (this.configuration.watchevents) {
            this.watchCronDebounced = debounce(
                this.watchFromCron.bind(this),
                DEBOUNCED_WATCH_CRON_MS,
            );
            this.listenDockerEventsTimeout = setTimeout(
                this.listenDockerEvents.bind(this),
                START_WATCHER_DELAY_MS,
            );
        }
    }

    initWatcher() {
        const options: Dockerode.DockerOptions = {};
        if (this.configuration.host) {
            options.host = this.configuration.host;
            options.port = this.configuration.port;
            if (this.configuration.protocol) {
                options.protocol = this.configuration.protocol;
            }
            if (this.configuration.cafile) {
                options.ca = fs.readFileSync(this.configuration.cafile);
            }
            if (this.configuration.certfile) {
                options.cert = fs.readFileSync(this.configuration.certfile);
            }
            if (this.configuration.keyfile) {
                options.key = fs.readFileSync(this.configuration.keyfile);
            }
            this.applyRemoteAuthHeaders(options);
        } else {
            options.socketPath = this.configuration.socket;
        }
        this.dockerApi = new Dockerode(options);
    }

    isHttpsRemoteWatcher(options: Dockerode.DockerOptions) {
        if (options.protocol === 'https') {
            return true;
        }
        return Boolean(options.ca || options.cert || options.key);
    }

    getOidcAuthConfiguration() {
        return this.configuration.auth?.oidc || {};
    }

    getOidcAuthString(paths: string[]) {
        return getFirstConfigString(this.getOidcAuthConfiguration(), paths);
    }

    getOidcAuthNumber(paths: string[]) {
        return getFirstConfigNumber(this.getOidcAuthConfiguration(), paths);
    }

    getRemoteAuthResolution(auth: any) {
        const hasBearer = Boolean(auth?.bearer);
        const hasBasic = Boolean(auth?.user && auth?.password);
        const hasOidcConfig = Boolean(
            getFirstConfigString(auth?.oidc, OIDC_TOKEN_ENDPOINT_PATHS) ||
                getFirstConfigString(auth?.oidc, OIDC_ACCESS_TOKEN_PATHS) ||
                getFirstConfigString(auth?.oidc, OIDC_REFRESH_TOKEN_PATHS),
        );
        let authType = `${auth?.type || ''}`.toLowerCase();
        if (!authType) {
            if (hasBearer) {
                authType = 'bearer';
            } else if (hasBasic) {
                authType = 'basic';
            } else if (hasOidcConfig) {
                authType = 'oidc';
            }
        }
        return { authType, hasBearer, hasBasic, hasOidcConfig };
    }

    setRemoteAuthorizationHeader(authorizationValue: string) {
        if (!authorizationValue) {
            return;
        }
        const dockerApiAny = this.dockerApi as any;
        if (!dockerApiAny.modem) {
            dockerApiAny.modem = {};
        }
        dockerApiAny.modem.headers = {
            ...(dockerApiAny.modem.headers || {}),
            Authorization: authorizationValue,
        };
    }

    initializeRemoteOidcStateFromConfiguration() {
        const configuredAccessToken = this.getOidcAuthString(
            OIDC_ACCESS_TOKEN_PATHS,
        );
        const configuredRefreshToken = this.getOidcAuthString(
            OIDC_REFRESH_TOKEN_PATHS,
        );
        const configuredExpiresInSeconds = this.getOidcAuthNumber(
            OIDC_EXPIRES_IN_PATHS,
        );

        if (configuredAccessToken && !this.remoteOidcAccessToken) {
            this.remoteOidcAccessToken = configuredAccessToken;
        }
        if (configuredRefreshToken && !this.remoteOidcRefreshToken) {
            this.remoteOidcRefreshToken = configuredRefreshToken;
        }
        if (
            configuredAccessToken &&
            configuredExpiresInSeconds !== undefined &&
            this.remoteOidcAccessTokenExpiresAt === undefined
        ) {
            this.remoteOidcAccessTokenExpiresAt =
                Date.now() + configuredExpiresInSeconds * 1000;
        }
    }

    getOidcGrantType() {
        const configuredGrantType = `${this.getOidcAuthString(OIDC_GRANT_TYPE_PATHS) || ''}`
            .trim()
            .toLowerCase();
        if (configuredGrantType) {
            return configuredGrantType;
        }
        if (this.remoteOidcRefreshToken) {
            return 'refresh_token';
        }
        return 'client_credentials';
    }

    isRemoteOidcTokenRefreshRequired() {
        if (!this.remoteOidcAccessToken) {
            return true;
        }
        if (this.remoteOidcAccessTokenExpiresAt === undefined) {
            return false;
        }
        return (
            this.remoteOidcAccessTokenExpiresAt <=
            Date.now() + OIDC_ACCESS_TOKEN_REFRESH_WINDOW_MS
        );
    }

    async refreshRemoteOidcAccessToken() {
        const tokenEndpoint = this.getOidcAuthString(OIDC_TOKEN_ENDPOINT_PATHS);
        if (!tokenEndpoint) {
            throw new Error(
                `Unable to refresh OIDC token for ${this.name}: missing auth.oidc token endpoint`,
            );
        }

        const oidcClientId = this.getOidcAuthString(OIDC_CLIENT_ID_PATHS);
        const oidcClientSecret = this.getOidcAuthString(OIDC_CLIENT_SECRET_PATHS);
        const oidcScope = this.getOidcAuthString(OIDC_SCOPE_PATHS);
        const oidcAudience = this.getOidcAuthString(OIDC_AUDIENCE_PATHS);
        const oidcResource = this.getOidcAuthString(OIDC_RESOURCE_PATHS);
        const oidcTimeout = this.getOidcAuthNumber(OIDC_TIMEOUT_PATHS);

        let grantType = this.getOidcGrantType();
        if (grantType === 'refresh_token' && !this.remoteOidcRefreshToken) {
            this.log.warn(
                `OIDC refresh token is missing for ${this.name}; fallback to client_credentials grant`,
            );
            grantType = 'client_credentials';
        }
        if (
            grantType !== 'client_credentials' &&
            grantType !== 'refresh_token'
        ) {
            this.log.warn(
                `OIDC grant type "${grantType}" is unsupported for ${this.name}; fallback to client_credentials`,
            );
            grantType = 'client_credentials';
        }

        const tokenRequestBody = new URLSearchParams();
        tokenRequestBody.set('grant_type', grantType);
        if (grantType === 'refresh_token' && this.remoteOidcRefreshToken) {
            tokenRequestBody.set('refresh_token', this.remoteOidcRefreshToken);
        }
        if (oidcClientId) {
            tokenRequestBody.set('client_id', oidcClientId);
        }
        if (oidcClientSecret) {
            tokenRequestBody.set('client_secret', oidcClientSecret);
        }
        if (oidcScope) {
            tokenRequestBody.set('scope', oidcScope);
        }
        if (oidcAudience) {
            tokenRequestBody.set('audience', oidcAudience);
        }
        if (oidcResource) {
            tokenRequestBody.set('resource', oidcResource);
        }

        const tokenResponse = await axios.post(
            tokenEndpoint,
            tokenRequestBody.toString(),
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                timeout: oidcTimeout || OIDC_DEFAULT_TIMEOUT_MS,
            },
        );
        const tokenPayload = tokenResponse?.data || {};
        const accessToken = tokenPayload.access_token;
        if (!accessToken) {
            throw new Error(
                `Unable to refresh OIDC token for ${this.name}: token endpoint response does not contain access_token`,
            );
        }

        this.remoteOidcAccessToken = accessToken;
        if (tokenPayload.refresh_token) {
            this.remoteOidcRefreshToken = tokenPayload.refresh_token;
        }
        const expiresIn = normalizeConfigNumberValue(tokenPayload.expires_in);
        this.remoteOidcAccessTokenExpiresAt =
            Date.now() +
            (expiresIn !== undefined
                ? expiresIn * 1000
                : OIDC_DEFAULT_ACCESS_TOKEN_TTL_MS);
    }

    async ensureRemoteAuthHeaders() {
        if (!this.configuration.host || !this.configuration.auth) {
            return;
        }

        const auth = this.configuration.auth;
        const { authType } = this.getRemoteAuthResolution(auth);
        if (authType !== 'oidc') {
            return;
        }
        if (
            !this.isHttpsRemoteWatcher({
                protocol: this.configuration.protocol,
                ca: this.configuration.cafile,
                cert: this.configuration.certfile,
                key: this.configuration.keyfile,
            } as Dockerode.DockerOptions)
        ) {
            return;
        }

        this.initializeRemoteOidcStateFromConfiguration();

        if (this.isRemoteOidcTokenRefreshRequired()) {
            await this.refreshRemoteOidcAccessToken();
        }
        if (!this.remoteOidcAccessToken) {
            throw new Error(
                `Unable to authenticate remote watcher ${this.name}: no OIDC access token available`,
            );
        }
        this.setRemoteAuthorizationHeader(`Bearer ${this.remoteOidcAccessToken}`);
    }

    applyRemoteAuthHeaders(options: Dockerode.DockerOptions) {
        const auth = this.configuration.auth;
        if (!auth) {
            return;
        }

        const { authType, hasBearer, hasBasic, hasOidcConfig } =
            this.getRemoteAuthResolution(auth);
        if (
            !hasBearer &&
            !hasBasic &&
            !hasOidcConfig &&
            authType !== 'oidc'
        ) {
            this.log.warn(
                `Skip remote watcher auth for ${this.name} because credentials are incomplete`,
            );
            return;
        }

        if (!this.isHttpsRemoteWatcher(options)) {
            this.log.warn(
                `Skip remote watcher auth for ${this.name} because HTTPS is required (set protocol=https or TLS certificates)`,
            );
            return;
        }

        if (authType === 'basic') {
            if (!hasBasic) {
                this.log.warn(
                    `Skip remote watcher auth for ${this.name} because basic credentials are incomplete`,
                );
                return;
            }
            const token = Buffer.from(`${auth.user}:${auth.password}`).toString(
                'base64',
            );
            options.headers = {
                ...options.headers,
                Authorization: `Basic ${token}`,
            };
            return;
        }

        if (authType === 'bearer') {
            if (!hasBearer) {
                this.log.warn(
                    `Skip remote watcher auth for ${this.name} because bearer token is missing`,
                );
                return;
            }
            options.headers = {
                ...options.headers,
                Authorization: `Bearer ${auth.bearer}`,
            };
            return;
        }

        if (authType === 'oidc') {
            this.initializeRemoteOidcStateFromConfiguration();
            if (this.remoteOidcAccessToken) {
                options.headers = {
                    ...options.headers,
                    Authorization: `Bearer ${this.remoteOidcAccessToken}`,
                };
            }
            return;
        }

        this.log.warn(
            `Skip remote watcher auth for ${this.name} because auth type "${auth.type}" is unsupported`,
        );
    }

    /**
     * Deregister the component.
     * @returns {Promise<void>}
     */
    async deregisterComponent() {
        if (this.watchCron) {
            this.watchCron.stop();
            delete this.watchCron;
        }
        if (this.watchCronTimeout) {
            clearTimeout(this.watchCronTimeout);
        }
        if (this.listenDockerEventsTimeout) {
            clearTimeout(this.listenDockerEventsTimeout);
            delete this.watchCronDebounced;
        }
    }

    /**
     * Listen and react to docker events.
     * @return {Promise<void>}
     */
    async listenDockerEvents() {
        this.ensureLogger();
        if (!this.log || typeof this.log.info !== 'function') {
            return;
        }
        try {
            await this.ensureRemoteAuthHeaders();
        } catch (e: any) {
            this.log.warn(
                `Unable to initialize remote watcher auth for docker events (${e.message})`,
            );
            return;
        }
        this.dockerEventsBuffer = '';
        this.log.info('Listening to docker events');
        const options: Dockerode.GetEventsOptions = {
            filters: {
                type: ['container'],
                event: [
                    'create',
                    'destroy',
                    'start',
                    'stop',
                    'pause',
                    'unpause',
                    'die',
                    'update',
                ],
            },
        };
        this.dockerApi.getEvents(options, (err, stream) => {
            if (err) {
                if (this.log && typeof this.log.warn === 'function') {
                    this.log.warn(
                        `Unable to listen to Docker events [${err.message}]`,
                    );
                    this.log.debug(err);
                }
            } else {
                stream.on('data', (chunk: any) => this.onDockerEvent(chunk));
            }
        });
    }

    isRecoverableDockerEventParseError(error: any) {
        const message = `${error?.message || ''}`.toLowerCase();
        return (
            message.includes('unexpected end of json input') ||
            message.includes('unterminated string in json')
        );
    }

    async processDockerEventPayload(
        dockerEventPayload: string,
        shouldTreatRecoverableErrorsAsPartial = false,
    ) {
        const payloadTrimmed = dockerEventPayload.trim();
        if (payloadTrimmed === '') {
            return true;
        }
        try {
            const dockerEvent = JSON.parse(payloadTrimmed);
            await this.processDockerEvent(dockerEvent);
            return true;
        } catch (e: any) {
            if (
                shouldTreatRecoverableErrorsAsPartial &&
                this.isRecoverableDockerEventParseError(e)
            ) {
                return false;
            }
            this.log.debug(`Unable to process Docker event (${e.message})`);
            return true;
        }
    }

    async processDockerEvent(dockerEvent: any) {
        const action = dockerEvent.Action;
        const containerId = dockerEvent.id;

        // If the container was created or destroyed => perform a watch
        if (action === 'destroy' || action === 'create') {
            await this.watchCronDebounced();
        } else {
            // Update container state in db if so
            try {
                await this.ensureRemoteAuthHeaders();
                const container = await this.dockerApi.getContainer(containerId);
                const containerInspect = await container.inspect();
                const newStatus = containerInspect.State.Status;
                const newName = (containerInspect.Name || '').replace(
                    /^\//,
                    '',
                );
                const containerFound = storeContainer.getContainer(containerId);
                if (containerFound) {
                    // Child logger for the container to process
                    const logContainer = this.log.child({
                        container: fullName(containerFound),
                    });
                    const oldStatus = containerFound.status;
                    const oldName = containerFound.name;
                    const oldDisplayName = containerFound.displayName;
                    const labelsFromInspect = containerInspect.Config?.Labels;
                    const labelsCurrent = containerFound.labels || {};
                    const labelsToApply = labelsFromInspect || labelsCurrent;
                    const labelsChanged =
                        JSON.stringify(labelsCurrent) !==
                        JSON.stringify(labelsToApply);
                    const customDisplayNameFromLabel =
                        labelsToApply[wudDisplayName];
                    const hasCustomDisplayName =
                        customDisplayNameFromLabel &&
                        customDisplayNameFromLabel.trim() !== '';

                    let changed = false;

                    if (oldStatus !== newStatus) {
                        containerFound.status = newStatus;
                        changed = true;
                        logContainer.info(
                            `Status changed from ${oldStatus} to ${newStatus}`,
                        );
                    }

                    if (newName !== '' && oldName !== newName) {
                        containerFound.name = newName;
                        changed = true;
                        logContainer.info(
                            `Name changed from ${oldName} to ${newName}`,
                        );
                    }

                    if (labelsChanged) {
                        containerFound.labels = labelsToApply;
                        changed = true;
                    }

                    if (hasCustomDisplayName) {
                        if (
                            containerFound.displayName !==
                            customDisplayNameFromLabel
                        ) {
                            containerFound.displayName =
                                customDisplayNameFromLabel;
                            changed = true;
                        }
                    } else if (
                        newName !== '' &&
                        oldName !== newName &&
                        (oldDisplayName === oldName ||
                            oldDisplayName === undefined ||
                            oldDisplayName === '')
                    ) {
                        containerFound.displayName = getContainerDisplayName(
                            newName,
                            containerFound.image?.name || '',
                            undefined,
                        );
                        changed = true;
                    }

                    if (changed) {
                        storeContainer.updateContainer(containerFound);
                    }
                }
            } catch (e: any) {
                this.log.debug(
                    `Unable to get container details for container id=[${containerId}] (${e.message})`,
                );
            }
        }
    }

    /**
     * Process a docker event.
     * @param dockerEventChunk
     * @return {Promise<void>}
     */
    async onDockerEvent(dockerEventChunk: any) {
        this.ensureLogger();
        this.dockerEventsBuffer += dockerEventChunk.toString();
        const dockerEventPayloads = this.dockerEventsBuffer.split('\n');
        const lastPayload = dockerEventPayloads.pop();
        this.dockerEventsBuffer = lastPayload === undefined ? '' : lastPayload;

        for (const dockerEventPayload of dockerEventPayloads) {
            await this.processDockerEventPayload(dockerEventPayload);
        }

        const bufferedPayload = this.dockerEventsBuffer.trim();
        if (
            bufferedPayload !== '' &&
            bufferedPayload.startsWith('{') &&
            bufferedPayload.endsWith('}')
        ) {
            const processed = await this.processDockerEventPayload(
                bufferedPayload,
                true,
            );
            if (processed) {
                this.dockerEventsBuffer = '';
            }
        }
    }

    /**
     * Watch containers (called by cron scheduled tasks).
     * @returns {Promise<*[]>}
     */
    async watchFromCron() {
        this.ensureLogger();
        if (!this.log || typeof this.log.info !== 'function') {
            return [];
        }
        this.log.info(`Cron started (${this.configuration.cron})`);

        // Get container reports
        const containerReports = await this.watch();

        // Count container reports
        const containerReportsCount = containerReports.length;

        // Count container available updates
        const containerUpdatesCount = containerReports.filter(
            (containerReport) => containerReport.container.updateAvailable,
        ).length;

        // Count container errors
        const containerErrorsCount = containerReports.filter(
            (containerReport) => containerReport.container.error !== undefined,
        ).length;

        const stats = `${containerReportsCount} containers watched, ${containerErrorsCount} errors, ${containerUpdatesCount} available updates`;
        this.ensureLogger();
        if (this.log && typeof this.log.info === 'function') {
            this.log.info(`Cron finished (${stats})`);
        }
        return containerReports;
    }

    /**
     * Watch main method.
     * @returns {Promise<*[]>}
     */
    async watch() {
        this.ensureLogger();
        let containers: Container[] = [];

        // Dispatch event to notify start watching
        event.emitWatcherStart(this);

        // List images to watch
        try {
            containers = await this.getContainers();
        } catch (e: any) {
            this.log.warn(
                `Error when trying to get the list of the containers to watch (${e.message})`,
            );
        }
        try {
            const containerReports = await Promise.all(
                containers.map((container) => this.watchContainer(container)),
            );
            event.emitContainerReports(containerReports);
            return containerReports;
        } catch (e: any) {
            this.log.warn(
                `Error when processing some containers (${e.message})`,
            );
            return [];
        } finally {
            // Dispatch event to notify stop watching
            event.emitWatcherStop(this);
        }
    }

    /**
     * Watch a Container.
     * @param container
     * @returns {Promise<*>}
     */
    async watchContainer(container: Container) {
        this.ensureLogger();
        // Child logger for the container to process
        const logContainer = this.log.child({ container: fullName(container) });
        const containerWithResult = container;

        // Reset previous results if so
        delete containerWithResult.result;
        delete containerWithResult.error;
        logContainer.debug('Start watching');

        try {
            containerWithResult.result = await this.findNewVersion(
                container,
                logContainer,
            );
        } catch (e: any) {
            logContainer.warn(`Error when processing (${e.message})`);
            logContainer.debug(e);
            containerWithResult.error = {
                message: e.message,
            };
        }

        const containerReport =
            this.mapContainerToContainerReport(containerWithResult);
        event.emitContainerReport(containerReport);
        return containerReport;
    }

    /**
     * Get all containers to watch.
     * @returns {Promise<unknown[]>}
     */
    async getContainers(): Promise<Container[]> {
        this.ensureLogger();
        await this.ensureRemoteAuthHeaders();
        const listContainersOptions: Dockerode.ContainerListOptions = {};
        if (this.configuration.watchall) {
            listContainersOptions.all = true;
        }
        const containers = await this.dockerApi.listContainers(
            listContainersOptions,
        );

        const swarmServiceLabelsCache = new Map<
            string,
            Promise<Record<string, string>>
        >();
        const containersWithResolvedLabels = await Promise.all(
            containers.map(async (container: any) => ({
                ...container,
                Labels: await this.getEffectiveContainerLabels(
                    container,
                    swarmServiceLabelsCache,
                ),
            })),
        );

        // Filter on containers to watch
        const filteredContainers = containersWithResolvedLabels.filter(
            (container: any) =>
                isContainerToWatch(
                    container.Labels[wudWatch],
                    this.configuration.watchbydefault,
                ),
        );
        const containerPromises = filteredContainers.map((container: any) =>
            this.addImageDetailsToContainer(
                container,
                container.Labels[wudTagInclude],
                container.Labels[wudTagExclude],
                container.Labels[wudTagTransform],
                container.Labels[wudLinkTemplate],
                container.Labels[wudDisplayName],
                container.Labels[wudDisplayIcon],
                container.Labels[wudTriggerInclude],
                container.Labels[wudTriggerExclude],
                container.Labels[wudRegistryLookupImage],
                container.Labels[wudRegistryLookupUrl],
            ).catch((e) => {
                this.log.warn(
                    `Failed to fetch image detail for container ${container.Id}: ${e.message}`,
                );
                return e;
            }),
        );
        const containersWithImage = (
            await Promise.all(containerPromises)
        ).filter((result) => !(result instanceof Error));

        // Return containers to process
        const containersToReturn = containersWithImage.filter(
            (imagePromise) => imagePromise !== undefined,
        );

        // Prune old containers from the store
        try {
            const containersFromTheStore = storeContainer.getContainers({
                watcher: this.name,
            });
            pruneOldContainers(containersToReturn, containersFromTheStore);
        } catch (e: any) {
            this.log.warn(
                `Error when trying to prune the old containers (${e.message})`,
            );
        }
        getWatchContainerGauge().set(
            {
                type: this.type,
                name: this.name,
            },
            containersToReturn.length,
        );

        return containersToReturn;
    }

    async getSwarmServiceLabels(
        serviceId: string,
        containerId: string,
    ): Promise<Record<string, string>> {
        if (typeof this.dockerApi.getService !== 'function') {
            return {};
        }

        try {
            const swarmService = await this.dockerApi
                .getService(serviceId)
                .inspect();
            const serviceLabels = swarmService?.Spec?.Labels || {};
            const taskContainerLabels =
                swarmService?.Spec?.TaskTemplate?.ContainerSpec?.Labels || {};
            return {
                ...serviceLabels,
                ...taskContainerLabels,
            };
        } catch (e: any) {
            this.log.debug(
                `Unable to inspect swarm service ${serviceId} for container ${containerId} (${e.message})`,
            );
            return {};
        }
    }

    async getEffectiveContainerLabels(
        container: any,
        serviceLabelsCache: Map<string, Promise<Record<string, string>>>,
    ): Promise<Record<string, string>> {
        const containerLabels = container.Labels || {};
        const serviceId = containerLabels[SWARM_SERVICE_ID_LABEL];

        if (!serviceId) {
            return containerLabels;
        }

        if (!serviceLabelsCache.has(serviceId)) {
            serviceLabelsCache.set(
                serviceId,
                this.getSwarmServiceLabels(serviceId, container.Id),
            );
        }
        const swarmServiceLabels = await serviceLabelsCache.get(serviceId);

        // Keep container labels as highest-priority override.
        return {
            ...(swarmServiceLabels || {}),
            ...containerLabels,
        };
    }

    getMatchingImgsetConfiguration(parsedImage: any): ResolvedImgset | undefined {
        const configuredImgsets = this.configuration.imgset;
        if (!configuredImgsets || typeof configuredImgsets !== 'object') {
            return undefined;
        }

        const matchingImgsets = Object.entries(configuredImgsets)
            .map(([imgsetName, imgsetConfiguration]: any) => {
                const imagePattern = getFirstConfigString(imgsetConfiguration, [
                    'image',
                    'match',
                ]);
                if (!imagePattern) {
                    return undefined;
                }
                const specificity = getImgsetSpecificity(imagePattern, parsedImage);
                if (specificity < 0) {
                    return undefined;
                }
                return {
                    specificity,
                    imgset: getResolvedImgsetConfiguration(
                        imgsetName,
                        imgsetConfiguration,
                    ),
                };
            })
            .filter((imgsetMatch: any) => imgsetMatch !== undefined)
            .sort((imgsetMatch1: any, imgsetMatch2: any) => {
                if (imgsetMatch1.specificity !== imgsetMatch2.specificity) {
                    return imgsetMatch2.specificity - imgsetMatch1.specificity;
                }
                return imgsetMatch1.imgset.name.localeCompare(
                    imgsetMatch2.imgset.name,
                );
            });

        if (matchingImgsets.length === 0) {
            return undefined;
        }
        return matchingImgsets[0].imgset;
    }

    /**
     * Find new version for a Container.
     */

    async findNewVersion(container: Container, logContainer: any) {
        const registryProvider = getRegistry(container.image.registry.name);
        const result: any = { tag: container.image.tag.value };
        if (!registryProvider) {
            logContainer.error(
                `Unsupported registry (${container.image.registry.name})`,
            );
            return result;
        } else {
            // Get all available tags
            const tags = await registryProvider.getTags(container.image);

            // Get candidate tags (based on tag name)
            const tagsCandidates = getTagCandidates(
                container,
                tags,
                logContainer,
            );

            // Must watch digest? => Find local/remote digests on registry
            if (container.image.digest.watch && container.image.digest.repo) {
                // If we have a tag candidate BUT we also watch digest
                // (case where local=`mongo:8` and remote=`mongo:8.0.0`),
                // Then get the digest of the tag candidate
                // Else get the digest of the same tag as the local one
                const imageToGetDigestFrom = JSON.parse(
                    JSON.stringify(container.image),
                );
                if (tagsCandidates.length > 0) {
                    [imageToGetDigestFrom.tag.value] = tagsCandidates;
                }

                const remoteDigest =
                    await registryProvider.getImageManifestDigest(
                        imageToGetDigestFrom,
                    );

                result.digest = remoteDigest.digest;
                result.created = remoteDigest.created;

                if (remoteDigest.version === 2) {
                    // Regular v2 manifest => Get manifest digest

                    const digestV2 =
                        await registryProvider.getImageManifestDigest(
                            imageToGetDigestFrom,
                            container.image.digest.repo,
                        );
                    container.image.digest.value = digestV2.digest;
                } else {
                    // Legacy v1 image => take Image digest as reference for comparison
                    await this.ensureRemoteAuthHeaders();
                    const image = await this.dockerApi
                        .getImage(container.image.id)
                        .inspect();
                    container.image.digest.value =
                        image.Config.Image === ''
                            ? undefined
                            : image.Config.Image;
                }
            }

            // The first one in the array is the highest
            if (tagsCandidates && tagsCandidates.length > 0) {
                [result.tag] = tagsCandidates;
            }
        }
        return result;
    }

    /**
     * Add image detail to Container.
     * @param container
     * @param includeTags
     * @param excludeTags
     * @param transformTags
     * @param linkTemplate
     * @param displayName
     * @param displayIcon
     * @returns {Promise<Image>}
     */
    async addImageDetailsToContainer(
        container: any,
        includeTags: string,
        excludeTags: string,
        transformTags: string,
        linkTemplate: string,
        displayName: string,
        displayIcon: string,
        triggerInclude: string,
        triggerExclude: string,
        registryLookupImage: string,
        registryLookupUrl: string,
    ) {
        const containerId = container.Id;
        const containerLabels = container.Labels || {};
        const includeTagsFromLabel = includeTags || containerLabels[wudTagInclude];
        const excludeTagsFromLabel = excludeTags || containerLabels[wudTagExclude];
        const transformTagsFromLabel =
            transformTags || containerLabels[wudTagTransform];
        const linkTemplateFromLabel =
            linkTemplate || containerLabels[wudLinkTemplate];
        const displayNameFromLabel =
            displayName || containerLabels[wudDisplayName];
        const displayIconFromLabel =
            displayIcon || containerLabels[wudDisplayIcon];
        const triggerIncludeFromLabel =
            triggerInclude || containerLabels[wudTriggerInclude];
        const triggerExcludeFromLabel =
            triggerExclude || containerLabels[wudTriggerExclude];
        const lookupImageFromLabel =
            registryLookupImage ||
            containerLabels[wudRegistryLookupImage] ||
            registryLookupUrl ||
            containerLabels[wudRegistryLookupUrl];

        // Is container already in store? just return it :)
        const containerInStore = storeContainer.getContainer(containerId);
        if (
            containerInStore !== undefined &&
            containerInStore.error === undefined
        ) {
            this.ensureLogger();
            this.log.debug(`Container ${containerInStore.id} already in store`);
            return containerInStore;
        }

        // Get container image details
        let image;
        try {
            await this.ensureRemoteAuthHeaders();
            image = await this.dockerApi.getImage(container.Image).inspect();
        } catch (e: any) {
            throw new Error(
                `Unable to inspect image for container ${containerId}: ${e.message}`,
            );
        }

        // Get useful properties
        const containerName = getContainerName(container);
        const status = container.State;
        const architecture = image.Architecture;
        const os = image.Os;
        const variant = image.Variant;
        const created = image.Created;
        const repoDigest = getRepoDigest(image);
        const imageId = image.Id;

        // Parse image to get registry, organization...
        let imageNameToParse = container.Image;
        if (imageNameToParse.includes('sha256:')) {
            if (!image.RepoTags || image.RepoTags.length === 0) {
                this.ensureLogger();
                this.log.warn(
                    `Cannot get a reliable tag for this image [${imageNameToParse}]`,
                );
                return Promise.resolve();
            }
            // Get the first repo tag (better than nothing ;)
            [imageNameToParse] = image.RepoTags;
        }
        const parsedImage = parse(imageNameToParse);
        const inspectTagPath = containerLabels[wudInspectTagPath];
        let tagName = parsedImage.tag || 'latest';
        if (inspectTagPath) {
            const semverTagFromInspect = getSemverTagFromInspectPath(
                image,
                inspectTagPath,
                transformTagsFromLabel,
            );
            if (semverTagFromInspect) {
                tagName = semverTagFromInspect;
            } else {
                this.ensureLogger();
                this.log.debug(
                    `No semver value found at inspect path ${inspectTagPath} for container ${containerId}; falling back to parsed image tag`,
                );
            }
        }
        const matchingImgset = this.getMatchingImgsetConfiguration(parsedImage);
        if (matchingImgset) {
            this.ensureLogger();
            this.log.debug(
                `Apply imgset "${matchingImgset.name}" to container ${containerId}`,
            );
        }

        const includeTagsValue = getContainerConfigValue(
            includeTagsFromLabel,
            matchingImgset?.includeTags,
        );
        const excludeTagsValue = getContainerConfigValue(
            excludeTagsFromLabel,
            matchingImgset?.excludeTags,
        );
        const transformTagsValue = getContainerConfigValue(
            transformTagsFromLabel,
            matchingImgset?.transformTags,
        );
        const linkTemplateValue = getContainerConfigValue(
            linkTemplateFromLabel,
            matchingImgset?.linkTemplate,
        );
        const displayNameValue = getContainerConfigValue(
            displayNameFromLabel,
            matchingImgset?.displayName,
        );
        const displayIconValue = getContainerConfigValue(
            displayIconFromLabel,
            matchingImgset?.displayIcon,
        );
        const triggerIncludeValue = getContainerConfigValue(
            triggerIncludeFromLabel,
            matchingImgset?.triggerInclude,
        );
        const triggerExcludeValue = getContainerConfigValue(
            triggerExcludeFromLabel,
            matchingImgset?.triggerExclude,
        );
        const lookupImageValue =
            getContainerConfigValue(
                lookupImageFromLabel,
                matchingImgset?.registryLookupImage,
            ) ||
            getContainerConfigValue(undefined, matchingImgset?.registryLookupUrl);

        const parsedTag = parseSemver(
            transformTag(transformTagsValue, tagName),
        );
        const isSemver = parsedTag !== null && parsedTag !== undefined;
        const watchDigest = isDigestToWatch(
            containerLabels[wudWatchDigest],
            parsedImage,
            isSemver,
        );
        if (!isSemver && !watchDigest) {
            this.ensureLogger();
            this.log.warn(
                "Image is not a semver and digest watching is disabled so wud won't report any update. Please review the configuration to enable digest watching for this container or exclude this container from being watched",
            );
        }
        return normalizeContainer({
            id: containerId,
            name: containerName,
            status,
            watcher: this.name,
            includeTags: includeTagsValue,
            excludeTags: excludeTagsValue,
            transformTags: transformTagsValue,
            linkTemplate: linkTemplateValue,
            displayName: getContainerDisplayName(
                containerName,
                parsedImage.path,
                displayNameValue,
            ),
            displayIcon: displayIconValue,
            triggerInclude: triggerIncludeValue,
            triggerExclude: triggerExcludeValue,
            image: {
                id: imageId,
                registry: {
                    name: 'unknown', // Will be overwritten by normalizeContainer
                    url: parsedImage.domain,
                    lookupImage: lookupImageValue,
                },
                name: parsedImage.path,
                tag: {
                    value: tagName,
                    semver: isSemver,
                },
                digest: {
                    watch: watchDigest,
                    repo: repoDigest,
                },
                architecture,
                os,
                variant,
                created,
            },
            labels: containerLabels,
            result: {
                tag: tagName,
            },
            updateAvailable: false,
            updateKind: { kind: 'unknown' },
        } as Container);
    }

    /**
     * Process a Container with result and map to a containerReport.
     * @param containerWithResult
     * @return {*}
     */
    mapContainerToContainerReport(containerWithResult: Container) {
        this.ensureLogger();
        const logContainer = this.log.child({
            container: fullName(containerWithResult),
        });
        const containerReport = {
            container: containerWithResult,
            changed: false,
        };

        // Find container in db & compare
        const containerInDb = storeContainer.getContainer(
            containerWithResult.id,
        );

        // Not found in DB? => Save it
        if (!containerInDb) {
            logContainer.debug('Container watched for the first time');
            containerReport.container =
                storeContainer.insertContainer(containerWithResult);
            containerReport.changed = true;

            // Found in DB? => update it
        } else {
            containerReport.container =
                storeContainer.updateContainer(containerWithResult);
            containerReport.changed =
                containerInDb.resultChanged(containerReport.container) &&
                containerWithResult.updateAvailable;
        }
        return containerReport;
    }
}

export default Docker;
