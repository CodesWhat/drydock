// @ts-nocheck
import crypto from 'node:crypto';
import parse from 'parse-docker-image-name';
import Trigger from '../Trigger.js';
import { getState } from '../../../registry/index.js';
import { fullName } from '../../../model/container.js';
import { emitContainerUpdateApplied, emitContainerUpdateFailed } from '../../../event/index.js';
import * as backupStore from '../../../store/backup.js';

const PULL_PROGRESS_LOG_INTERVAL_MS = 2000;

/**
 * Replace a Docker container with an updated one.
 */
class Docker extends Trigger {
    public strictAgentMatch = true;

    sanitizeEndpointConfig(endpointConfig, currentContainerId) {
        if (!endpointConfig) {
            return {};
        }

        const sanitizedEndpointConfig: Record<string, any> = {};

        if (endpointConfig.IPAMConfig) {
            sanitizedEndpointConfig.IPAMConfig = endpointConfig.IPAMConfig;
        }
        if (endpointConfig.Links) {
            sanitizedEndpointConfig.Links = endpointConfig.Links;
        }
        if (endpointConfig.DriverOpts) {
            sanitizedEndpointConfig.DriverOpts = endpointConfig.DriverOpts;
        }
        if (endpointConfig.MacAddress) {
            sanitizedEndpointConfig.MacAddress = endpointConfig.MacAddress;
        }
        if (endpointConfig.Aliases && endpointConfig.Aliases.length > 0) {
            sanitizedEndpointConfig.Aliases = endpointConfig.Aliases.filter(
                (alias) => !currentContainerId.startsWith(alias),
            );
        }

        return sanitizedEndpointConfig;
    }

    getPrimaryNetworkName(containerToCreate, networkNames) {
        const networkMode = containerToCreate?.HostConfig?.NetworkMode;
        if (networkMode && networkNames.includes(networkMode)) {
            return networkMode;
        }
        return networkNames[0];
    }

    /**
     * Get the Trigger configuration schema.
     * @returns {*}
     */
    getConfigurationSchema() {
        return this.joi.object().keys({
            prune: this.joi.boolean().default(false),
            dryrun: this.joi.boolean().default(false),
            autoremovetimeout: this.joi.number().default(10_000),
            backupcount: this.joi.number().default(3),
        });
    }

    /**
     * Get watcher responsible for the container.
     * @param container
     * @returns {*}
     */

    getWatcher(container) {
        return getState().watcher[`docker.${container.watcher}`];
    }

    /**
     * Get current container.
     * @param dockerApi
     * @param container
     * @returns {Promise<*>}
     */
    async getCurrentContainer(dockerApi, container) {
        this.log.debug(`Get container ${container.id}`);
        try {
            return await dockerApi.getContainer(container.id);
        } catch (e) {
            this.log.warn(`Error when getting container ${container.id}`);
            throw e;
        }
    }

    /**
     * Inspect container.
     * @param container
     * @returns {Promise<*>}
     */
    async inspectContainer(container, logContainer) {
        this.log.debug(`Inspect container ${container.id}`);
        try {
            return await container.inspect();
        } catch (e) {
            logContainer.warn(
                `Error when inspecting container ${container.id}`,
            );
            throw e;
        }
    }

    /**
     * Prune previous image versions.
     * @param dockerApi
     * @param registry
     * @param container
     * @param logContainer
     * @returns {Promise<void>}
     */
    async pruneImages(dockerApi, registry, container, logContainer) {
        logContainer.info('Pruning previous tags');
        try {
            // Get all pulled images
            const images = await dockerApi.listImages();

            // Find all pulled images to remove
            const imagesToRemove = images
                .filter((image) => {
                    // Exclude images without repo tags
                    if (!image.RepoTags || image.RepoTags.length === 0) {
                        return false;
                    }
                    const imageParsed = parse(image.RepoTags[0]);
                    const imageNormalized = registry.normalizeImage({
                        registry: {
                            url: imageParsed.domain ? imageParsed.domain : '',
                        },
                        tag: {
                            value: imageParsed.tag,
                        },
                        name: imageParsed.path,
                    });

                    // Exclude different registries
                    if (
                        imageNormalized.registry.name !==
                        container.image.registry.name
                    ) {
                        return false;
                    }

                    // Exclude different names
                    if (imageNormalized.name !== container.image.name) {
                        return false;
                    }

                    // Exclude current container image
                    if (
                        imageNormalized.tag.value ===
                        container.updateKind.localValue
                    ) {
                        return false;
                    }

                    // Exclude candidate image
                    if (
                        imageNormalized.tag.value ===
                        container.updateKind.remoteValue
                    ) {
                        return false;
                    }

                    // For digest-only updates, also exclude the current tag
                    // (localValue/remoteValue are digests, not tags)
                    if (
                        container.updateKind.kind === 'digest' &&
                        imageNormalized.tag.value ===
                            container.image.tag.value
                    ) {
                        return false;
                    }
                    return true;
                })
                .map((imageToRemove) => dockerApi.getImage(imageToRemove.Id));
            await Promise.all(
                imagesToRemove.map((imageToRemove) => {
                    logContainer.info(`Prune image ${imageToRemove.name}`);
                    return imageToRemove.remove();
                }),
            );
        } catch (e) {
            logContainer.warn(
                `Some errors occurred when trying to prune previous tags (${e.message})`,
            );
        }
    }

    formatPullProgress(progressEvent) {
        const progressDetail = progressEvent?.progressDetail || {};
        if (
            typeof progressDetail.current === 'number' &&
            typeof progressDetail.total === 'number' &&
            progressDetail.total > 0
        ) {
            const percentage = Math.round(
                (progressDetail.current * 100) / progressDetail.total,
            );
            return `${progressDetail.current}/${progressDetail.total} (${percentage}%)`;
        }
        if (
            progressEvent &&
            typeof progressEvent.progress === 'string' &&
            progressEvent.progress.trim() !== ''
        ) {
            return progressEvent.progress;
        }
        return undefined;
    }

    createPullProgressLogger(logContainer, imageName) {
        let lastLogAt = 0;
        let lastProgressSnapshot = '';
        const logProgress = (progressEvent, force = false) => {
            if (!progressEvent || typeof logContainer.debug !== 'function') {
                return;
            }

            const status = progressEvent.status || 'progress';
            const layer = progressEvent.id ? ` layer=${progressEvent.id}` : '';
            const progress = this.formatPullProgress(progressEvent);
            const progressSnapshot = progress
                ? `${status}${layer} ${progress}`
                : `${status}${layer}`;
            const now = Date.now();

            if (
                !force &&
                now - lastLogAt < PULL_PROGRESS_LOG_INTERVAL_MS &&
                progressSnapshot === lastProgressSnapshot
            ) {
                return;
            }
            if (!force && now - lastLogAt < PULL_PROGRESS_LOG_INTERVAL_MS) {
                return;
            }

            lastLogAt = now;
            lastProgressSnapshot = progressSnapshot;
            logContainer.debug(
                `Pull progress for ${imageName}: ${progressSnapshot}`,
            );
        };

        return {
            onProgress: (progressEvent) => logProgress(progressEvent),
            onDone: (progressEvent) => logProgress(progressEvent, true),
        };
    }

    /**
     * Pull new image.
     * @param dockerApi
     * @param auth
     * @param newImage
     * @param logContainer
     * @returns {Promise<void>}
     */

    async pullImage(dockerApi, auth, newImage, logContainer) {
        logContainer.info(`Pull image ${newImage}`);
        try {
            const pullStream = await dockerApi.pull(newImage, {
                authconfig: auth,
            });
            const pullProgressLogger = this.createPullProgressLogger(
                logContainer,
                newImage,
            );

            await new Promise((resolve, reject) =>
                dockerApi.modem.followProgress(
                    pullStream,
                    (error, output) => {
                        if (
                            Array.isArray(output) &&
                            output.length > 0
                        ) {
                            pullProgressLogger.onDone(output[output.length - 1]);
                        }
                        if (error) {
                            reject(error);
                        } else {
                            resolve(undefined);
                        }
                    },
                    (progressEvent) => {
                        pullProgressLogger.onProgress(progressEvent);
                    },
                ),
            );
            logContainer.info(`Image ${newImage} pulled with success`);
        } catch (e) {
            logContainer.warn(
                `Error when pulling image ${newImage} (${e.message})`,
            );
            throw e;
        }
    }

    /**
     * Stop a container.
     * @param container
     * @param containerName
     * @param containerId
     * @param logContainer
     * @returns {Promise<void>}
     */

    async stopContainer(container, containerName, containerId, logContainer) {
        logContainer.info(
            `Stop container ${containerName} with id ${containerId}`,
        );
        try {
            await container.stop();
            logContainer.info(
                `Container ${containerName} with id ${containerId} stopped with success`,
            );
        } catch (e) {
            logContainer.warn(
                `Error when stopping container ${containerName} with id ${containerId}`,
            );
            throw e;
        }
    }

    /**
     * Remove a container.
     * @param container
     * @param containerName
     * @param containerId
     * @param logContainer
     * @returns {Promise<void>}
     */
    async removeContainer(container, containerName, containerId, logContainer) {
        logContainer.info(
            `Remove container ${containerName} with id ${containerId}`,
        );
        try {
            await container.remove();
            logContainer.info(
                `Container ${containerName} with id ${containerId} removed with success`,
            );
        } catch (e) {
            logContainer.warn(
                `Error when removing container ${containerName} with id ${containerId}`,
            );
            throw e;
        }
    }

    /**
     * Wait for a container to be removed.
     */
    async waitContainerRemoved(
        container,
        containerName,
        containerId,
        logContainer,
    ) {
        logContainer.info(
            `Wait container ${containerName} with id ${containerId}`,
        );
        try {
            await container.wait({
                condition: 'removed',
                abortSignal: AbortSignal.timeout(
                    this.configuration.autoremovetimeout,
                ),
            });
            logContainer.info(
                `Container ${containerName} with id ${containerId} auto-removed successfully`,
            );
        } catch (e) {
            logContainer.warn(
                e,
                `Error while waiting for container ${containerName} with id ${containerId}`,
            );
            throw e;
        }
    }

    /**
     * Create a new container.
     * @param dockerApi
     * @param containerToCreate
     * @param containerName
     * @param logContainer
     * @returns {Promise<*>}
     */
    async createContainer(
        dockerApi,
        containerToCreate,
        containerName,
        logContainer,
    ) {
        logContainer.info(`Create container ${containerName}`);
        try {
            let containerToCreatePayload = containerToCreate;
            const endpointsConfig =
                containerToCreate.NetworkingConfig?.EndpointsConfig || {};
            const endpointNetworkNames = Object.keys(endpointsConfig);
            const additionalNetworkNames = [];

            if (endpointNetworkNames.length > 1) {
                const primaryNetworkName = this.getPrimaryNetworkName(
                    containerToCreate,
                    endpointNetworkNames,
                );

                containerToCreatePayload = {
                    ...containerToCreate,
                    NetworkingConfig: {
                        EndpointsConfig: {
                            [primaryNetworkName]:
                                endpointsConfig[primaryNetworkName],
                        },
                    },
                };
                additionalNetworkNames.push(
                    ...endpointNetworkNames.filter(
                        (networkName) => networkName !== primaryNetworkName,
                    ),
                );
            }

            const newContainer =
                await dockerApi.createContainer(containerToCreatePayload);

            for (const networkName of additionalNetworkNames) {
                logContainer.info(
                    `Connect container ${containerName} to network ${networkName}`,
                );
                const network = dockerApi.getNetwork(networkName);
                await network.connect({
                    Container: containerName,
                    EndpointConfig: endpointsConfig[networkName],
                });
                logContainer.info(
                    `Container ${containerName} connected to network ${networkName} with success`,
                );
            }

            logContainer.info(
                `Container ${containerName} recreated on new image with success`,
            );
            return newContainer;
        } catch (e) {
            logContainer.warn(
                `Error when creating container ${containerName} (${e.message})`,
            );
            throw e;
        }
    }

    /**
     * Start container.
     * @param container
     * @param containerName
     * @param logContainer
     * @returns {Promise<void>}
     */
    async startContainer(container, containerName, logContainer) {
        logContainer.info(`Start container ${containerName}`);
        try {
            await container.start();
            logContainer.info(
                `Container ${containerName} started with success`,
            );
        } catch (e) {
            logContainer.warn(`Error when starting container ${containerName}`);
            throw e;
        }
    }

    /**
     * Remove an image.
     * @param dockerApi
     * @param imageToRemove
     * @param logContainer
     * @returns {Promise<void>}
     */
    async removeImage(dockerApi, imageToRemove, logContainer) {
        logContainer.info(`Remove image ${imageToRemove}`);
        try {
            const image = await dockerApi.getImage(imageToRemove);
            await image.remove();
            logContainer.info(`Image ${imageToRemove} removed with success`);
        } catch (e) {
            logContainer.warn(`Error when removing image ${imageToRemove}`);
            throw e;
        }
    }

    /**
     * Clone container specs.
     * @param currentContainer
     * @param newImage
     * @returns {*}
     */
    cloneContainer(currentContainer, newImage) {
        const containerName = currentContainer.Name.replace('/', '');
        const currentContainerNetworks =
            currentContainer.NetworkSettings?.Networks || {};
        const endpointsConfig = Object.entries(currentContainerNetworks).reduce(
            (acc: Record<string, any>, [networkName, endpointConfig]) => {
                acc[networkName] = this.sanitizeEndpointConfig(
                    endpointConfig,
                    currentContainer.Id,
                );
                return acc;
            },
            {},
        );

        const containerClone = {
            ...currentContainer.Config,
            name: containerName,
            Image: newImage,
            HostConfig: currentContainer.HostConfig,
            NetworkingConfig: {
                EndpointsConfig: endpointsConfig,
            },
        };
        // Handle situation when container is using network_mode: service:other_service
        if (
            containerClone.HostConfig &&
            containerClone.HostConfig.NetworkMode &&
            containerClone.HostConfig.NetworkMode.startsWith('container:')
        ) {
            delete containerClone.Hostname;
            delete containerClone.ExposedPorts;
        }

        return containerClone;
    }

    /**
     * Get image full name.
     * @param registry the registry
     * @param container the container
     */
    getNewImageFullName(registry, container) {
        // Tag to pull/run is
        // either the same (when updateKind is digest)
        // or the new one (when updateKind is tag)
        const tagOrDigest =
            container.updateKind.kind === 'digest'
                ? container.image.tag.value
                : container.updateKind.remoteValue;

        // Rebuild image definition string
        return registry.getImageFullName(container.image, tagOrDigest);
    }

    /**
     * Stop and remove (or wait for auto-removal of) a container.
     */
    async stopAndRemoveContainer(
        currentContainer,
        currentContainerSpec,
        container,
        logContainer,
    ) {
        if (currentContainerSpec.State.Running) {
            await this.stopContainer(
                currentContainer,
                container.name,
                container.id,
                logContainer,
            );
        }

        if (currentContainerSpec.HostConfig?.AutoRemove !== true) {
            await this.removeContainer(
                currentContainer,
                container.name,
                container.id,
                logContainer,
            );
        } else {
            await this.waitContainerRemoved(
                currentContainer,
                container.name,
                container.id,
                logContainer,
            );
        }
    }

    /**
     * Create a new container from the cloned spec and start it if
     * the previous container was running.
     */
    async recreateContainer(
        dockerApi,
        currentContainerSpec,
        newImage,
        container,
        logContainer,
    ) {
        const containerToCreateInspect = this.cloneContainer(
            currentContainerSpec,
            newImage,
            logContainer,
        );

        const newContainer = await this.createContainer(
            dockerApi,
            containerToCreateInspect,
            container.name,
            logContainer,
        );

        if (currentContainerSpec.State.Running) {
            await this.startContainer(
                newContainer,
                container.name,
                logContainer,
            );
        }
    }

    /**
     * Remove old images after a container update when pruning is enabled.
     */
    async cleanupOldImages(dockerApi, registry, container, logContainer) {
        if (!this.configuration.prune) return;

        if (container.updateKind.kind === 'tag') {
            const oldImage = registry.getImageFullName(
                container.image,
                container.image.tag.value,
            );
            await this.removeImage(dockerApi, oldImage, logContainer);
        } else if (
            container.updateKind.kind === 'digest' &&
            container.image.digest.repo
        ) {
            try {
                const oldImage = registry.getImageFullName(
                    container.image,
                    container.image.digest.repo,
                );
                await this.removeImage(dockerApi, oldImage, logContainer);
            } catch (e) {
                logContainer.debug(
                    `Unable to remove previous digest image (${e.message})`,
                );
            }
        }
    }

    /**
     * Preview what an update would do without performing it.
     * @param container the container
     * @returns {Promise<object>} preview info
     */
    async preview(container) {
        const logContainer = this.log.child({ container: fullName(container) });
        const watcher = this.getWatcher(container);
        const { dockerApi } = watcher;
        const registry = getState().registry[container.image.registry.name];
        const newImage = this.getNewImageFullName(registry, container);

        const currentContainer = await this.getCurrentContainer(dockerApi, container);
        if (!currentContainer) {
            return { error: 'Container not found in Docker' };
        }
        const currentContainerSpec = await this.inspectContainer(currentContainer, logContainer);

        return {
            containerName: container.name,
            currentImage: `${container.image.registry.name}/${container.image.name}:${container.image.tag.value}`,
            newImage,
            updateKind: container.updateKind,
            isRunning: currentContainerSpec.State.Running,
            networks: Object.keys(currentContainerSpec.NetworkSettings?.Networks || {}),
        };
    }

    /**
     * Update the container.
     * @param container the container
     * @returns {Promise<void>}
     */
    async trigger(container) {
        // Child logger for the container to process
        const logContainer = this.log.child({ container: fullName(container) });

        try {
            // Get watcher
            const watcher = this.getWatcher(container);

            // Get dockerApi from watcher
            const { dockerApi } = watcher;

            // Get registry configuration
            logContainer.debug(
                `Get ${container.image.registry.name} registry manager`,
            );
            const registry = getState().registry[container.image.registry.name];

            logContainer.debug(
                `Get ${container.image.registry.name} registry credentials`,
            );
            const auth = await registry.getAuthPull();

            // Rebuild image definition string
            const newImage = this.getNewImageFullName(registry, container);

            // Get current container
            const currentContainer = await this.getCurrentContainer(
                dockerApi,
                container,
            );

            if (!currentContainer) {
                logContainer.warn(
                    'Unable to update the container because it does not exist',
                );
                return;
            }

            const currentContainerSpec = await this.inspectContainer(
                currentContainer,
                logContainer,
            );

            // Try to remove previous pulled images
            if (this.configuration.prune) {
                await this.pruneImages(
                    dockerApi,
                    registry,
                    container,
                    logContainer,
                );
            }

            // Save a backup of the current image before updating
            backupStore.insertBackup({
                id: crypto.randomUUID(),
                containerId: container.id,
                containerName: container.name,
                imageName: `${container.image.registry.name}/${container.image.name}`,
                imageTag: container.image.tag.value,
                imageDigest: container.image.digest?.repo,
                timestamp: new Date().toISOString(),
                triggerName: this.getId(),
            });

            // Pull new image ahead of time
            await this.pullImage(dockerApi, auth, newImage, logContainer);

            // Dry-run?
            if (this.configuration.dryrun) {
                logContainer.info(
                    'Do not replace the existing container because dry-run mode is enabled',
                );
                return;
            }

            await this.stopAndRemoveContainer(
                currentContainer,
                currentContainerSpec,
                container,
                logContainer,
            );

            await this.recreateContainer(
                dockerApi,
                currentContainerSpec,
                newImage,
                container,
                logContainer,
            );

            await this.cleanupOldImages(
                dockerApi,
                registry,
                container,
                logContainer,
            );

            // Notify that this container has been updated so notification
            // triggers can dismiss previously sent messages.
            await emitContainerUpdateApplied(fullName(container));

            // Prune old backups, keeping only the configured number
            backupStore.pruneOldBackups(container.id, this.configuration.backupcount);
        } catch (e: any) {
            await emitContainerUpdateFailed({
                containerName: fullName(container),
                error: e.message,
            });
            throw e;
        }
    }

    /**
     * Update the containers.
     * @param containers
     * @returns {Promise<unknown[]>}
     */
    async triggerBatch(containers) {
        return Promise.all(
            containers.map((container) => this.trigger(container)),
        );
    }
}

export default Docker;
