import fs from 'fs';
import Dockerode from 'dockerode';
import Joi from 'joi';
import JoiCronExpression from 'joi-cron-expression';
const joi = JoiCronExpression(Joi);
import cron from 'node-cron';
import parse from 'parse-docker-image-name';
import debounce from 'just-debounce';
import {
    parse as parseSemver,
    isGreater as isGreaterSemver,
    transform as transformTag,
} from '../../../tag';
import * as event from '../../../event';
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
} from './label';
import * as storeContainer from '../../../store/container';
import log from '../../../log';
import {
    validate as validateContainer,
    fullName,
    Container,
    ContainerImage,
} from '../../../model/container';
import * as registry from '../../../registry';
import { getWatchContainerGauge } from '../../../prometheus/watcher';
import Watcher from '../../Watcher';
import { ComponentConfiguration } from '../../../registry/Component';

export interface DockerWatcherConfiguration extends ComponentConfiguration {
    socket: string;
    host?: string;
    port: number;
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
}

// The delay before starting the watcher when the app is started
const START_WATCHER_DELAY_MS = 1000;

// Debounce delay used when performing a watch after a docker event has been received
const DEBOUNCED_WATCH_CRON_MS = 5000;
const SWARM_SERVICE_ID_LABEL = 'com.docker.swarm.service.id';

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
            port: this.joi.number().port().default(2375),
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
        });
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
            if (this.configuration.cafile) {
                options.ca = fs.readFileSync(this.configuration.cafile);
            }
            if (this.configuration.certfile) {
                options.cert = fs.readFileSync(this.configuration.certfile);
            }
            if (this.configuration.keyfile) {
                options.key = fs.readFileSync(this.configuration.keyfile);
            }
        } else {
            options.socketPath = this.configuration.socket;
        }
        this.dockerApi = new Dockerode(options);
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
                const container = await this.dockerApi.getContainer(containerId);
                const containerInspect = await container.inspect();
                const newStatus = containerInspect.State.Status;
                const containerFound = storeContainer.getContainer(containerId);
                if (containerFound) {
                    // Child logger for the container to process
                    const logContainer = this.log.child({
                        container: fullName(containerFound),
                    });
                    const oldStatus = containerFound.status;
                    containerFound.status = newStatus;
                    if (oldStatus !== newStatus) {
                        storeContainer.updateContainer(containerFound);
                        logContainer.info(
                            `Status changed from ${oldStatus} to ${newStatus}`,
                        );
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
        const lookupImageValue =
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
                transformTags,
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
        const parsedTag = parseSemver(transformTag(transformTags, tagName));
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
            includeTags,
            excludeTags,
            transformTags,
            linkTemplate,
            displayName: getContainerDisplayName(
                containerName,
                parsedImage.path,
                displayName,
            ),
            displayIcon,
            triggerInclude,
            triggerExclude,
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
