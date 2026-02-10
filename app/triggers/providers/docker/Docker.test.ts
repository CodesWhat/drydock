// @ts-nocheck
import joi from 'joi';
import Docker from './Docker.js';
import log from '../../../log/index.js';

const configurationValid = {
    prune: false,
    dryrun: false,
    threshold: 'all',
    mode: 'simple',
    once: true,
    auto: true,
    order: 100,
    autoremovetimeout: 10000,
    simpletitle:
        'New ${container.updateKind.kind} found for container ${container.name}',
    simplebody:
        'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
    batchtitle: '${containers.length} updates available',
    resolvenotifications: false,
};

const docker = new Docker();
docker.configuration = configurationValid;
docker.log = log;

vi.mock('../../../registry', () => ({
    getState() {
        return {
            watcher: {
                'docker.test': {
                    getId: () => 'docker.test',
                    watch: () => Promise.resolve(),
                    dockerApi: {
                        getContainer: (id) => {
                            if (id === '123456789') {
                                return Promise.resolve({
                                    inspect: () =>
                                        Promise.resolve({
                                            Name: '/container-name',
                                            Id: '123456798',
                                            State: {
                                                Running: true,
                                            },
                                            NetworkSettings: {
                                                Networks: {
                                                    test: {
                                                        Aliases: [
                                                            '9708fc7b44f2',
                                                            'test',
                                                        ],
                                                    },
                                                },
                                            },
                                        }),
                                    stop: () => Promise.resolve(),
                                    remove: () => Promise.resolve(),
                                    start: () => Promise.resolve(),
                                });
                            }
                            return Promise.reject(
                                new Error('Error when getting container'),
                            );
                        },
                        createContainer: (container) => {
                            if (container.name === 'container-name') {
                                return Promise.resolve({
                                    start: () => Promise.resolve(),
                                });
                            }
                            return Promise.reject(
                                new Error('Error when creating container'),
                            );
                        },
                        pull: (image) => {
                            if (
                                image === 'test/test:1.2.3' ||
                                image === 'my-registry/test/test:4.5.6'
                            ) {
                                return Promise.resolve();
                            }
                            return Promise.reject(
                                new Error('Error when pulling image'),
                            );
                        },
                        getImage: (image) =>
                            Promise.resolve({
                                remove: () => {
                                    if (image === 'test/test:1.2.3') {
                                        return Promise.resolve();
                                    }
                                    return Promise.reject(
                                        new Error('Error when removing image'),
                                    );
                                },
                            }),
                        modem: {
                            followProgress: (pullStream, res) => res(),
                        },
                    },
                },
            },
            registry: {
                hub: {
                    getAuthPull: async () => undefined,
                    getImageFullName: (image, tagOrDigest) =>
                        `${image.registry.url}/${image.name}:${tagOrDigest}`,
                },
            },
        };
    },
}));

// --- Shared factories and helpers ---

/** Build a mock dockerApi for pruneImages tests */
function createPruneDockerApi(images, removeSpy = vi.fn().mockResolvedValue(undefined)) {
    return {
        listImages: vi.fn().mockResolvedValue(images),
        getImage: vi.fn().mockReturnValue({ name: 'image-to-remove', remove: removeSpy }),
    };
}

/** Standard normalizeImage mock that echoes registry name, image name, and tag */
function createEchoNormalizeRegistry(registryName = 'ecr') {
    return {
        normalizeImage: (img) => ({
            registry: { name: registryName },
            name: img.name,
            tag: { value: img.tag.value },
        }),
    };
}

/** Default container fixture for pruneImages tests */
function createPruneContainer(overrides = {}) {
    return {
        image: { registry: { name: 'ecr' }, name: 'repo', tag: { value: '1.0.0' } },
        updateKind: { kind: 'tag', localValue: '1.0.0', remoteValue: '2.0.0' },
        ...overrides,
    };
}

/** Build a container payload for trigger tests */
function createTriggerContainer(overrides = {}) {
    return {
        watcher: 'test',
        id: '123456789',
        name: 'container-name',
        image: {
            name: 'test/test',
            registry: { name: 'hub', url: 'my-registry' },
            tag: { value: '1.0.0' },
        },
        updateKind: { kind: 'tag', remoteValue: '4.5.6' },
        ...overrides,
    };
}

/** Spy on all Docker methods needed for trigger flow (non-dryrun, non-running) */
function stubTriggerFlow(opts = {}) {
    const {
        running = false,
        autoRemove = false,
        inspectOverrides = {},
    } = opts;

    const waitSpy = vi.fn().mockResolvedValue();
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue({
        inspect: () => Promise.resolve(),
        remove: vi.fn(),
        stop: () => Promise.resolve(),
        wait: waitSpy,
    });
    vi.spyOn(docker, 'inspectContainer').mockResolvedValue({
        Name: '/container-name',
        Id: '123',
        State: { Running: running },
        Config: {},
        HostConfig: { ...(autoRemove ? { AutoRemove: true } : {}) },
        NetworkSettings: { Networks: {} },
        ...inspectOverrides,
    });
    vi.spyOn(docker, 'pruneImages').mockResolvedValue();
    vi.spyOn(docker, 'pullImage').mockResolvedValue();
    vi.spyOn(docker, 'cloneContainer').mockReturnValue({ name: 'container-name' });
    vi.spyOn(docker, 'stopContainer').mockResolvedValue();
    vi.spyOn(docker, 'removeContainer').mockResolvedValue();
    vi.spyOn(docker, 'createContainer').mockResolvedValue({ start: vi.fn() });
    vi.spyOn(docker, 'startContainer').mockResolvedValue();
    const removeImageSpy = vi.spyOn(docker, 'removeImage').mockResolvedValue();

    return { waitSpy, removeImageSpy };
}

/** Create a mock log with common methods */
function createMockLog(...methods) {
    const mockLog = {};
    for (const m of methods) {
        mockLog[m] = vi.fn();
    }
    return mockLog;
}

beforeEach(async () => {
    vi.resetAllMocks();
    docker.configuration = configurationValid;
    docker.log = log;
});

// --- Configuration validation ---

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        docker.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {
        url: 'git://xxx.com',
    };
    expect(() => {
        docker.validateConfiguration(configuration);
    }).toThrowError(joi.ValidationError);
});

// --- getWatcher ---

test('getWatcher should return watcher responsible for a container', async () => {
    expect(
        docker
            .getWatcher({
                watcher: 'test',
            })
            .getId(),
    ).toEqual('docker.test');
});

// --- getCurrentContainer ---

test('getCurrentContainer should return container from dockerApi', async () => {
    await expect(
        docker.getCurrentContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            { id: '123456789' },
        ),
    ).resolves.not.toBeUndefined();
});

test('getCurrentContainer should throw error when error occurs', async () => {
    await expect(
        docker.getCurrentContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            { id: 'unknown' },
        ),
    ).rejects.toThrowError('Error when getting container');
});

// --- inspectContainer ---

test('inspectContainer should return container details from dockerApi', async () => {
    await expect(
        docker.inspectContainer({ inspect: () => Promise.resolve({}) }, log),
    ).resolves.toEqual({});
});

test('inspectContainer should throw error when error occurs', async () => {
    await expect(
        docker.inspectContainer(
            { inspect: () => Promise.reject(new Error('No container')) },
            log,
        ),
    ).rejects.toThrowError('No container');
});

// --- Container operations: stop, remove, wait, start (parametric) ---

describe.each([
    {
        method: 'stopContainer',
        action: 'stop',
        args: (stub) => [stub, 'name', 'id', log],
    },
    {
        method: 'removeContainer',
        action: 'remove',
        args: (stub) => [stub, 'name', 'id', log],
    },
    {
        method: 'waitContainerRemoved',
        action: 'wait',
        args: (stub) => [stub, 'name', 'id', log],
    },
    {
        method: 'startContainer',
        action: 'start',
        args: (stub) => [stub, 'name', log],
    },
])('$method', ({ method, action, args }) => {
    test('should resolve when successful', async () => {
        const stub = { [action]: () => Promise.resolve() };
        await expect(docker[method](...args(stub))).resolves.toBeUndefined();
    });

    test('should throw error when error occurs', async () => {
        const stub = { [action]: () => Promise.reject(new Error('No container')) };
        await expect(docker[method](...args(stub))).rejects.toThrowError('No container');
    });
});

// --- createContainer ---

test('createContainer should stop container from dockerApi', async () => {
    await expect(
        docker.createContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            { name: 'container-name' },
            'name',
            log,
        ),
    ).resolves.not.toBeUndefined();
});

test('createContainer should throw error when error occurs', async () => {
    await expect(
        docker.createContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            { name: 'ko' },
            'name',
            log,
        ),
    ).rejects.toThrowError('Error when creating container');
});

test('createContainer should connect additional networks after create', async () => {
    const connect = vi.fn().mockResolvedValue(undefined);
    const getNetwork = vi.fn().mockReturnValue({ connect });
    const createContainer = vi.fn().mockResolvedValue({
        start: () => Promise.resolve(),
    });
    const logContainer = createMockLog('info', 'warn');

    const containerToCreate = {
        name: 'container-name',
        HostConfig: {
            NetworkMode: 'cloud_default',
        },
        NetworkingConfig: {
            EndpointsConfig: {
                cloud_default: { Aliases: ['container-name'] },
                postgres_default: { Aliases: ['container-name'] },
                valkey_default: { Aliases: ['container-name'] },
            },
        },
    };

    await docker.createContainer(
        { createContainer, getNetwork },
        containerToCreate,
        'container-name',
        logContainer,
    );

    expect(createContainer).toHaveBeenCalledWith({
        name: 'container-name',
        HostConfig: {
            NetworkMode: 'cloud_default',
        },
        NetworkingConfig: {
            EndpointsConfig: {
                cloud_default: { Aliases: ['container-name'] },
            },
        },
    });
    expect(getNetwork).toHaveBeenCalledTimes(2);
    expect(getNetwork).toHaveBeenCalledWith('postgres_default');
    expect(getNetwork).toHaveBeenCalledWith('valkey_default');
    expect(connect).toHaveBeenCalledTimes(2);
    expect(connect).toHaveBeenCalledWith({
        Container: 'container-name',
        EndpointConfig: { Aliases: ['container-name'] },
    });
});

// --- pullImage ---

test('pull should pull image from dockerApi', async () => {
    await expect(
        docker.pullImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            undefined,
            'test/test:1.2.3',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('pull should throw error when error occurs', async () => {
    await expect(
        docker.pullImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            undefined,
            'test/test:unknown',
            log,
        ),
    ).rejects.toThrowError('Error when pulling image');
});

test('pull should emit progress logs from followProgress events', async () => {
    const dockerApi = {
        pull: vi.fn().mockResolvedValue({}),
        modem: {
            followProgress: vi.fn((pullStream, done, onProgress) => {
                onProgress({
                    id: 'layer-1',
                    status: 'Downloading',
                    progressDetail: { current: 50, total: 100 },
                });
                done(null, [{ id: 'layer-1', status: 'Download complete' }]);
            }),
        },
    };
    const logContainer = createMockLog('info', 'warn', 'debug');

    await docker.pullImage(dockerApi, undefined, 'test/test:1.2.3', logContainer);

    expect(logContainer.debug).toHaveBeenCalledWith(
        expect.stringContaining('Pull progress for test/test:1.2.3'),
    );
    expect(logContainer.info).toHaveBeenCalledWith(
        'Image test/test:1.2.3 pulled with success',
    );
});

test('pull should throw error when followProgress reports an error', async () => {
    const dockerApi = {
        pull: vi.fn().mockResolvedValue({}),
        modem: {
            followProgress: vi.fn((pullStream, done) => {
                done(new Error('Pull progress failed'));
            }),
        },
    };
    const logContainer = createMockLog('info', 'warn', 'debug');

    await expect(
        docker.pullImage(dockerApi, undefined, 'test/test:1.2.3', logContainer),
    ).rejects.toThrowError('Pull progress failed');
});

// --- removeImage ---

test('removeImage should pull image from dockerApi', async () => {
    await expect(
        docker.removeImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            'test/test:1.2.3',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('removeImage should throw error when error occurs', async () => {
    await expect(
        docker.removeImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            'test/test:unknown',
            log,
        ),
    ).rejects.toThrowError('Error when removing image');
});

// --- cloneContainer ---

test('clone should clone an existing container spec', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789',
            HostConfig: { a: 'a', b: 'b' },
            Config: { configA: 'a', configB: 'b' },
            NetworkSettings: {
                Networks: {
                    test: { Aliases: ['9708fc7b44f2', 'test'] },
                },
            },
        },
        'test/test:2.0.0',
    );
    expect(clone).toEqual({
        HostConfig: { a: 'a', b: 'b' },
        Image: 'test/test:2.0.0',
        configA: 'a',
        configB: 'b',
        name: 'test',
        NetworkingConfig: {
            EndpointsConfig: {
                test: { Aliases: ['9708fc7b44f2', 'test'] },
            },
        },
    });
});

test('clone should remove dynamic network endpoint fields and stale aliases', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789abcdef',
            HostConfig: { NetworkMode: 'cloud_default' },
            Config: { configA: 'a' },
            NetworkSettings: {
                Networks: {
                    cloud_default: {
                        Aliases: ['123456789abc', 'nextcloud'],
                        NetworkID: 'network-id',
                        EndpointID: 'endpoint-id',
                        Gateway: '172.18.0.1',
                        IPAddress: '172.18.0.2',
                        DriverOpts: { test: 'value' },
                    },
                },
            },
        },
        'test/test:2.0.0',
    );

    expect(clone.NetworkingConfig.EndpointsConfig).toEqual({
        cloud_default: {
            Aliases: ['nextcloud'],
            DriverOpts: { test: 'value' },
        },
    });
});

test('cloneContainer should remove Hostname and ExposedPorts when NetworkMode starts with container:', () => {
    const clone = docker.cloneContainer(
        {
            Name: '/sidecar',
            Id: 'abc123',
            HostConfig: { NetworkMode: 'container:mainapp' },
            Config: {
                Hostname: 'sidecar-host',
                ExposedPorts: { '80/tcp': {} },
                configA: 'a',
            },
            NetworkSettings: { Networks: {} },
        },
        'test/test:2.0.0',
    );
    expect(clone.Hostname).toBeUndefined();
    expect(clone.ExposedPorts).toBeUndefined();
    expect(clone.HostConfig.NetworkMode).toBe('container:mainapp');
});

// --- trigger ---

test('trigger should not throw when all is ok', async () => {
    await expect(
        docker.trigger({
            watcher: 'test',
            id: '123456789',
            Name: '/container-name',
            image: {
                name: 'test/test',
                registry: { name: 'hub', url: 'my-registry' },
            },
            updateKind: { remoteValue: '4.5.6' },
        }),
    ).resolves.toBeUndefined();
});

test('trigger should not throw in dryrun mode', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    docker.log = log;
    await expect(
        docker.trigger(createTriggerContainer({ name: 'test-container' })),
    ).resolves.toBeUndefined();
});

test('trigger should use waitContainerRemoved when AutoRemove is true', async () => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: false };
    docker.log = log;
    const { waitSpy } = stubTriggerFlow({ running: true, autoRemove: true });

    await docker.trigger(createTriggerContainer());

    expect(waitSpy).toHaveBeenCalled();
});

test('trigger should prune old image by tag after non-dryrun update', async () => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: true };
    docker.log = log;
    const { removeImageSpy } = stubTriggerFlow();

    await docker.trigger(createTriggerContainer());

    expect(removeImageSpy).toHaveBeenCalled();
});

test('trigger should prune old image by digest repo after non-dryrun update', async () => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: true };
    docker.log = log;
    const { removeImageSpy } = stubTriggerFlow();

    await docker.trigger(createTriggerContainer({
        image: {
            name: 'test/test',
            registry: { name: 'hub', url: 'my-registry' },
            tag: { value: 'latest' },
            digest: { repo: 'sha256:olddigest' },
        },
        updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    }));

    expect(removeImageSpy).toHaveBeenCalled();
});

test('trigger should catch error when removing digest image fails', async () => {
    docker.configuration = { ...configurationValid, dryrun: false, prune: true };
    docker.log = log;
    stubTriggerFlow();
    vi.spyOn(docker, 'removeImage').mockRejectedValue(new Error('remove failed'));

    // Should not throw
    await docker.trigger(createTriggerContainer({
        image: {
            name: 'test/test',
            registry: { name: 'hub', url: 'my-registry' },
            tag: { value: 'latest' },
            digest: { repo: 'sha256:olddigest' },
        },
        updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    }));
});

test('trigger should not throw when container does not exist', async () => {
    docker.configuration = { ...configurationValid, dryrun: false };
    docker.log = log;
    vi.spyOn(docker, 'getCurrentContainer').mockResolvedValue(null);

    await expect(
        docker.trigger(createTriggerContainer({ name: 'test-container' })),
    ).resolves.toBeUndefined();
});

// --- triggerBatch ---

test('triggerBatch should call trigger for each container', async () => {
    const triggerSpy = vi.spyOn(docker, 'trigger').mockResolvedValue();
    const containers = [{ name: 'c1' }, { name: 'c2' }];
    await docker.triggerBatch(containers);
    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy).toHaveBeenCalledWith({ name: 'c1' });
    expect(triggerSpy).toHaveBeenCalledWith({ name: 'c2' });
});

// --- pruneImages (parametric: exclusion filters) ---

describe('pruneImages exclusion filters', () => {
    test.each([
        {
            scenario: 'should exclude the current tag when updateKind is digest',
            images: [
                { Id: 'image-current', RepoTags: ['ecr.example.com/repo:nginx-prod'] },
                { Id: 'image-other', RepoTags: ['ecr.example.com/repo:other-tag'] },
            ],
            container: createPruneContainer({
                image: { registry: { name: 'ecr' }, name: 'repo', tag: { value: 'nginx-prod' } },
                updateKind: { kind: 'digest', localValue: 'sha256:olddigest', remoteValue: 'sha256:newdigest' },
            }),
            expectedGetImageCalls: 1,
            expectedGetImageArgs: ['image-other'],
        },
        {
            scenario: 'should not exclude current tag when updateKind is tag',
            images: [
                { Id: 'image-current', RepoTags: ['ecr.example.com/repo:1.0.0'] },
                { Id: 'image-other', RepoTags: ['ecr.example.com/repo:0.9.0'] },
            ],
            container: createPruneContainer(),
            expectedGetImageCalls: 1,
            expectedGetImageArgs: ['image-other'],
        },
    ])('$scenario', async ({ images, container, expectedGetImageCalls, expectedGetImageArgs }) => {
        const mockDockerApi = createPruneDockerApi(images);

        await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), container, log);

        expect(mockDockerApi.getImage).toHaveBeenCalledTimes(expectedGetImageCalls);
        for (const arg of expectedGetImageArgs) {
            expect(mockDockerApi.getImage).toHaveBeenCalledWith(arg);
        }
    });
});

describe('pruneImages should not prune excluded images', () => {
    test.each([
        {
            scenario: 'images from different registries',
            images: [{ Id: 'image-diff-registry', RepoTags: ['other-registry.com/repo:1.0.0'] }],
            registryName: 'other-reg',
        },
        {
            scenario: 'images with different names',
            images: [{ Id: 'image-diff-name', RepoTags: ['ecr.example.com/other-repo:0.9.0'] }],
            registryName: 'ecr',
        },
        {
            scenario: 'images matching remoteValue',
            images: [{ Id: 'image-remote', RepoTags: ['ecr.example.com/repo:2.0.0'] }],
            registryName: 'ecr',
        },
    ])('$scenario', async ({ images, registryName }) => {
        const mockDockerApi = createPruneDockerApi(images);

        await docker.pruneImages(
            mockDockerApi,
            createEchoNormalizeRegistry(registryName),
            createPruneContainer(),
            log,
        );

        expect(mockDockerApi.getImage).not.toHaveBeenCalled();
    });
});

describe('pruneImages edge cases', () => {
    test.each([
        {
            scenario: 'should exclude images without RepoTags (null)',
            images: [{ Id: 'image-no-tags', RepoTags: null }],
        },
        {
            scenario: 'should exclude images without RepoTags (empty)',
            images: [{ Id: 'image-empty-tags', RepoTags: [] }],
        },
        {
            scenario: 'should exclude images without RepoTags (null and empty)',
            images: [
                { Id: 'image-no-tags', RepoTags: null },
                { Id: 'image-empty-tags', RepoTags: [] },
            ],
        },
    ])('$scenario', async ({ images }) => {
        const mockDockerApi = createPruneDockerApi(images);

        await docker.pruneImages(
            mockDockerApi,
            { normalizeImage: vi.fn() },
            createPruneContainer(),
            log,
        );

        expect(mockDockerApi.getImage).not.toHaveBeenCalled();
    });

    test('should warn when error occurs during pruning', async () => {
        const mockDockerApi = {
            listImages: vi.fn().mockRejectedValue(new Error('list failed')),
        };
        const logContainer = createMockLog('info', 'warn');

        await docker.pruneImages(mockDockerApi, {}, createPruneContainer(), logContainer);

        expect(logContainer.warn).toHaveBeenCalledWith(
            expect.stringContaining('list failed'),
        );
    });
});

// --- Duplicate pruneImages tests (longer-form, kept for backward compatibility) ---

test('pruneImages should exclude images with different names', async () => {
    const mockDockerApi = createPruneDockerApi([
        { Id: 'image-different-name', RepoTags: ['ecr.example.com/different-repo:1.0.0'] },
    ]);
    const containerTagUpdate = createPruneContainer();

    await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), containerTagUpdate, log);

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude candidate image (remoteValue)', async () => {
    const mockDockerApi = createPruneDockerApi([
        { Id: 'image-candidate', RepoTags: ['ecr.example.com/repo:2.0.0'] },
    ]);
    const containerTagUpdate = createPruneContainer();

    await docker.pruneImages(mockDockerApi, createEchoNormalizeRegistry(), containerTagUpdate, log);

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude images without RepoTags', async () => {
    const mockDockerApi = createPruneDockerApi([
        { Id: 'image-no-tags', RepoTags: [] },
        { Id: 'image-null-tags' },
    ]);

    await docker.pruneImages(
        mockDockerApi,
        { normalizeImage: vi.fn() },
        createPruneContainer(),
        log,
    );

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should exclude images with different registry', async () => {
    const mockDockerApi = createPruneDockerApi([
        { Id: 'image-diff-registry', RepoTags: ['other-registry.io/repo:0.8.0'] },
    ]);

    await docker.pruneImages(
        mockDockerApi,
        createEchoNormalizeRegistry('other-registry'),
        createPruneContainer(),
        log,
    );

    expect(mockDockerApi.getImage).not.toHaveBeenCalled();
});

test('pruneImages should warn when error occurs during pruning', async () => {
    const mockDockerApi = {
        listImages: vi.fn().mockRejectedValue(new Error('list failed')),
    };
    const logContainer = createMockLog('info', 'warn');

    await docker.pruneImages(mockDockerApi, {}, createPruneContainer(), logContainer);

    expect(logContainer.warn).toHaveBeenCalledWith(
        expect.stringContaining('list failed'),
    );
});

// --- getNewImageFullName ---

test('getNewImageFullName should use tag value for digest updates', () => {
    const mockRegistry = {
        getImageFullName: (image, tagOrDigest) =>
            `${image.registry.url}/${image.name}:${tagOrDigest}`,
    };
    const containerDigest = {
        image: {
            name: 'test/test',
            tag: { value: 'nginx-prod' },
            registry: { url: 'my-registry' },
        },
        updateKind: { kind: 'digest', remoteValue: 'sha256:newdigest' },
    };
    const result = docker.getNewImageFullName(mockRegistry, containerDigest);
    expect(result).toBe('my-registry/test/test:nginx-prod');
});

// --- createPullProgressLogger ---

test('createPullProgressLogger should throttle duplicate snapshots within interval', () => {
    const logContainer = createMockLog('debug');
    const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');

    logger.onProgress({ status: 'Downloading', id: 'layer-1', progressDetail: { current: 50, total: 100 } });
    expect(logContainer.debug).toHaveBeenCalledTimes(1);

    // Immediate repeat with same data should be throttled
    logger.onProgress({ status: 'Downloading', id: 'layer-1', progressDetail: { current: 50, total: 100 } });
    expect(logContainer.debug).toHaveBeenCalledTimes(1);

    // Different data but within interval should still be throttled
    logger.onProgress({ status: 'Downloading', id: 'layer-1', progressDetail: { current: 75, total: 100 } });
    expect(logContainer.debug).toHaveBeenCalledTimes(1);
});

test('createPullProgressLogger should handle null/undefined progressEvent', () => {
    const logContainer = createMockLog('debug');
    const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');
    logger.onProgress(null);
    logger.onProgress(undefined);
    expect(logContainer.debug).not.toHaveBeenCalled();
});

test('createPullProgressLogger onDone should force log regardless of interval', () => {
    const logContainer = createMockLog('debug');
    const logger = docker.createPullProgressLogger(logContainer, 'test:1.0');
    logger.onProgress({ status: 'Downloading', id: 'l1', progressDetail: { current: 50, total: 100 } });
    logger.onDone({ status: 'Download complete', id: 'l1' });
    expect(logContainer.debug).toHaveBeenCalledTimes(2);
});

// --- formatPullProgress ---

test('formatPullProgress should return string progress when progressDetail is missing', () => {
    expect(docker.formatPullProgress({ progress: '[==> ] 50%' })).toBe('[==> ] 50%');
});

test('formatPullProgress should return undefined when no progress data', () => {
    expect(docker.formatPullProgress({ status: 'Waiting' })).toBeUndefined();
    expect(docker.formatPullProgress({})).toBeUndefined();
});

test('formatPullProgress should return formatted percentage', () => {
    expect(docker.formatPullProgress({ progressDetail: { current: 50, total: 200 } })).toBe('50/200 (25%)');
});

// --- sanitizeEndpointConfig ---

test('sanitizeEndpointConfig should return empty object for undefined config', () => {
    expect(docker.sanitizeEndpointConfig(undefined, 'abc')).toEqual({});
});

test('sanitizeEndpointConfig should copy IPAMConfig, Links, DriverOpts, MacAddress', () => {
    const config = {
        IPAMConfig: { IPv4Address: '10.0.0.5' }, // NOSONAR - test fixture IP
        Links: ['link1'],
        DriverOpts: { opt: 'val' },
        MacAddress: '02:42:ac:11:00:02',
    };
    const result = docker.sanitizeEndpointConfig(config, 'abc');
    expect(result).toEqual(config);
});

// --- getPrimaryNetworkName ---

test('getPrimaryNetworkName should return NetworkMode when it exists in network names', () => {
    const container = { HostConfig: { NetworkMode: 'custom_net' } };
    expect(docker.getPrimaryNetworkName(container, ['bridge', 'custom_net'])).toBe('custom_net');
});

test('getPrimaryNetworkName should return first network when NetworkMode not in list', () => {
    const container = { HostConfig: { NetworkMode: 'host' } };
    expect(docker.getPrimaryNetworkName(container, ['bridge', 'custom'])).toBe('bridge');
});
