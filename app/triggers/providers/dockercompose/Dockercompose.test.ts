// @ts-nocheck
import Docker from '../docker/Docker';
import Dockercompose from './Dockercompose';
import { getState } from '../../../registry';

jest.mock('../../../registry', () => ({
    getState: jest.fn(),
}));

describe('Dockercompose Trigger', () => {
    let trigger;
    let mockLog;

    beforeEach(() => {
        jest.clearAllMocks();

        mockLog = {
            info: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            child: jest.fn().mockReturnThis(),
        };

        trigger = new Dockercompose();
        trigger.log = mockLog;
        trigger.configuration = {
            dryrun: true,
            backup: false,
            composeFileLabel: 'wud.compose.file',
        };

        getState.mockReturnValue({
            registry: {
                hub: {
                    getImageFullName: (image, tag) => `${image.name}:${tag}`,
                },
            },
        });
    });

    test('mapCurrentVersionToUpdateVersion should ignore services without image', () => {
        const compose = {
            services: {
                wud: {
                    environment: ['WUD_TRIGGER_DOCKERCOMPOSE_BASE_AUTO=false'],
                },
                portainer: {
                    image: 'portainer/portainer-ce:2.27.4',
                },
            },
        };
        const container = {
            name: 'portainer',
            image: {
                name: 'portainer/portainer-ce',
                registry: { name: 'hub' },
                tag: { value: '2.27.4' },
            },
            updateKind: {
                kind: 'tag',
                remoteValue: '2.27.5',
            },
        };

        const result = trigger.mapCurrentVersionToUpdateVersion(
            compose,
            container,
        );

        expect(result).toEqual({
            current: 'portainer/portainer-ce:2.27.4',
            update: 'portainer/portainer-ce:2.27.5',
        });
    });

    test('processComposeFile should not fail when compose has partial services', async () => {
        const container = {
            name: 'portainer',
            image: {
                name: 'portainer/portainer-ce',
                registry: { name: 'hub' },
                tag: { value: '2.27.4' },
            },
            updateKind: {
                kind: 'tag',
                remoteValue: '2.27.5',
            },
        };

        jest.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue({
            services: {
                wud: {
                    environment: ['WUD_TRIGGER_DOCKERCOMPOSE_BASE_AUTO=false'],
                },
                portainer: {
                    image: 'portainer/portainer-ce:2.27.4',
                },
            },
        });

        const dockerTriggerSpy = jest
            .spyOn(Docker.prototype, 'trigger')
            .mockResolvedValue();

        await trigger.processComposeFile('/tmp/portainer.yml', [container]);

        expect(dockerTriggerSpy).toHaveBeenCalledWith(container);
    });

    test('processComposeFile should only trigger containers with actual image changes', async () => {
        const tagContainer = {
            name: 'nginx',
            image: {
                name: 'nginx',
                registry: { name: 'hub' },
                tag: { value: '1.0.0' },
            },
            updateKind: {
                kind: 'tag',
                remoteValue: '1.1.0',
            },
        };
        const digestContainer = {
            name: 'redis',
            image: {
                name: 'redis',
                registry: { name: 'hub' },
                tag: { value: '7.0.0' },
            },
            updateKind: {
                kind: 'digest',
                remoteValue: 'sha256:deadbeef',
            },
        };

        jest.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue({
            services: {
                nginx: { image: 'nginx:1.0.0' },
                redis: { image: 'redis:7.0.0' },
            },
        });

        const dockerTriggerSpy = jest
            .spyOn(Docker.prototype, 'trigger')
            .mockResolvedValue();

        await trigger.processComposeFile('/tmp/stack.yml', [
            tagContainer,
            digestContainer,
        ]);

        expect(dockerTriggerSpy).toHaveBeenCalledTimes(1);
        expect(dockerTriggerSpy).toHaveBeenCalledWith(tagContainer);
    });

    test('processComposeFile should skip writes and triggers when no service image changes are needed', async () => {
        trigger.configuration.dryrun = false;
        const container = {
            name: 'redis',
            image: {
                name: 'redis',
                registry: { name: 'hub' },
                tag: { value: '7.0.0' },
            },
            updateKind: {
                kind: 'digest',
                remoteValue: 'sha256:deadbeef',
            },
        };

        jest.spyOn(trigger, 'getComposeFileAsObject').mockResolvedValue({
            services: {
                redis: { image: 'redis:7.0.0' },
            },
        });

        const getComposeFileSpy = jest.spyOn(trigger, 'getComposeFile');
        const writeComposeFileSpy = jest.spyOn(trigger, 'writeComposeFile');
        const dockerTriggerSpy = jest
            .spyOn(Docker.prototype, 'trigger')
            .mockResolvedValue();

        await trigger.processComposeFile('/tmp/stack.yml', [container]);

        expect(getComposeFileSpy).not.toHaveBeenCalled();
        expect(writeComposeFileSpy).not.toHaveBeenCalled();
        expect(dockerTriggerSpy).not.toHaveBeenCalled();
        expect(mockLog.info).toHaveBeenCalledWith(
            expect.stringContaining('already up to date'),
        );
    });
});
