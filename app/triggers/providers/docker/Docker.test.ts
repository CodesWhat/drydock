// @ts-nocheck
import { ValidationError } from 'joi';
import Docker from './Docker';
import log from '../../../log';

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
};

const docker = new Docker();
docker.configuration = configurationValid;
docker.log = log;

jest.mock('../../../registry', () => ({
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
                    getAuthPull: () => undefined,
                    getImageFullName: (image, tagOrDigest) =>
                        `${image.registry.url}/${image.name}:${tagOrDigest}`,
                },
            },
        };
    },
}));

beforeEach(async () => {
    jest.resetAllMocks();
});

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
    }).toThrowError(ValidationError);
});

test('getWatcher should return watcher responsible for a container', async () => {
    expect(
        docker
            .getWatcher({
                watcher: 'test',
            })
            .getId(),
    ).toEqual('docker.test');
});

test('getCurrentContainer should return container from dockerApi', async () => {
    await expect(
        docker.getCurrentContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                id: '123456789',
            },
        ),
    ).resolves.not.toBeUndefined();
});

test('getCurrentContainer should throw error when error occurs', async () => {
    await expect(
        docker.getCurrentContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                id: 'unknown',
            },
        ),
    ).rejects.toThrowError('Error when getting container');
});

test('inspectContainer should return container details from dockerApi', async () => {
    await expect(
        docker.inspectContainer(
            {
                inspect: () => Promise.resolve({}),
            },
            log,
        ),
    ).resolves.toEqual({});
});

test('inspectContainer should throw error when error occurs', async () => {
    await expect(
        docker.inspectContainer(
            {
                inspect: () => Promise.reject(new Error('No container')),
            },
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('stopContainer should stop container from dockerApi', async () => {
    await expect(
        docker.stopContainer(
            {
                stop: () => Promise.resolve(),
            },
            'name',
            'id',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('stopContainer should throw error when error occurs', async () => {
    await expect(
        docker.stopContainer(
            {
                stop: () => Promise.reject(new Error('No container')),
            },
            'name',
            'id',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('removeContainer should stop container from dockerApi', async () => {
    await expect(
        docker.removeContainer(
            {
                remove: () => Promise.resolve(),
            },
            'name',
            'id',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('removeContainer should throw error when error occurs', async () => {
    await expect(
        docker.removeContainer(
            {
                remove: () => Promise.reject(new Error('No container')),
            },
            'name',
            'id',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('waitContainerRemoved should wait for the container to be removed from dockerApi', async () => {
    await expect(
        docker.waitContainerRemoved(
            {
                wait: () => Promise.resolve(),
            },
            'name',
            'id',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('waitContainerRemoved should throw error when error occurs', async () => {
    await expect(
        docker.waitContainerRemoved(
            {
                wait: () => Promise.reject(new Error('No container')),
            },
            'name',
            'id',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('startContainer should stop container from dockerApi', async () => {
    await expect(
        docker.startContainer(
            {
                start: () => Promise.resolve(),
            },
            'name',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('startContainer should throw error when error occurs', async () => {
    await expect(
        docker.startContainer(
            {
                start: () => Promise.reject(new Error('No container')),
            },
            'name',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('createContainer should stop container from dockerApi', async () => {
    await expect(
        docker.createContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                name: 'container-name',
            },
            'name',
            log,
        ),
    ).resolves.not.toBeUndefined();
});

test('createContainer should throw error when error occurs', async () => {
    await expect(
        docker.createContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                name: 'ko',
            },
            'name',
            log,
        ),
    ).rejects.toThrowError('Error when creating container');
});

test('createContainer should connect additional networks after create', async () => {
    const connect = jest.fn().mockResolvedValue(undefined);
    const getNetwork = jest.fn().mockReturnValue({ connect });
    const createContainer = jest.fn().mockResolvedValue({
        start: () => Promise.resolve(),
    });
    const logContainer = {
        info: jest.fn(),
        warn: jest.fn(),
    };

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
        {
            createContainer,
            getNetwork,
        },
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

test('clone should clone an existing container spec', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789',
            HostConfig: {
                a: 'a',
                b: 'b',
            },
            Config: {
                configA: 'a',
                configB: 'b',
            },
            NetworkSettings: {
                Networks: {
                    test: {
                        Aliases: ['9708fc7b44f2', 'test'],
                    },
                },
            },
        },
        'test/test:2.0.0',
    );
    expect(clone).toEqual({
        HostConfig: {
            a: 'a',
            b: 'b',
        },
        Image: 'test/test:2.0.0',
        configA: 'a',
        configB: 'b',
        name: 'test',
        NetworkingConfig: {
            EndpointsConfig: {
                test: {
                    Aliases: ['9708fc7b44f2', 'test'],
                },
            },
        },
    });
});

test('clone should remove dynamic network endpoint fields and stale aliases', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789abcdef',
            HostConfig: {
                NetworkMode: 'cloud_default',
            },
            Config: {
                configA: 'a',
            },
            NetworkSettings: {
                Networks: {
                    cloud_default: {
                        Aliases: ['123456789abc', 'nextcloud'],
                        NetworkID: 'network-id',
                        EndpointID: 'endpoint-id',
                        Gateway: '172.18.0.1',
                        IPAddress: '172.18.0.2',
                        DriverOpts: {
                            test: 'value',
                        },
                    },
                },
            },
        },
        'test/test:2.0.0',
    );

    expect(clone.NetworkingConfig.EndpointsConfig).toEqual({
        cloud_default: {
            Aliases: ['nextcloud'],
            DriverOpts: {
                test: 'value',
            },
        },
    });
});

test('trigger should not throw when all is ok', async () => {
    await expect(
        docker.trigger({
            watcher: 'test',
            id: '123456789',
            Name: '/container-name',
            image: {
                name: 'test/test',
                registry: {
                    name: 'hub',
                    url: 'my-registry',
                },
            },
            updateKind: {
                remoteValue: '4.5.6',
            },
        }),
    ).resolves.toBeUndefined();
});
