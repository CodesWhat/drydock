import Component, { ComponentConfiguration } from '../../registry/Component';
import * as event from '../../event';
import { getTriggerCounter } from '../../prometheus/trigger';
import { fullName, Container } from '../../model/container';

export interface TriggerConfiguration extends ComponentConfiguration {
    auto?: boolean;
    order?: number;
    threshold?: string;
    mode?: string;
    once?: boolean;
    simpletitle?: string;
    simplebody?: string;
    batchtitle?: string;
}

export interface ContainerReport {
    container: Container;
    changed: boolean;
}

/**
 * Render body or title simple template.
 * @param template
 * @param container
 * @returns {*}
 */
function renderSimple(template: string, container: Container) {
    // Set deprecated vars for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const id = container.id;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const name = container.name;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const watcher = container.watcher;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const kind =
        container.updateKind && container.updateKind.kind
            ? container.updateKind.kind
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const semver =
        container.updateKind && container.updateKind.semverDiff
            ? container.updateKind.semverDiff
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const local =
        container.updateKind && container.updateKind.localValue
            ? container.updateKind.localValue
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const remote =
        container.updateKind && container.updateKind.remoteValue
            ? container.updateKind.remoteValue
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const link =
        container.result && container.result.link ? container.result.link : '';
    // eslint-disable-next-line no-eval
    return eval('`' + template + '`');
}

function renderBatch(template: string, containers: Container[]) {
    // Set deprecated vars for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const count = containers ? containers.length : 0;
    // eslint-disable-next-line no-eval
    return eval('`' + template + '`');
}

/**
 * Trigger base component.
 */
class Trigger extends Component {
    public configuration: TriggerConfiguration = {};
    public strictAgentMatch = false;
    private unregisterContainerReport?: () => void;
    private unregisterContainerReports?: () => void;

    static getSupportedThresholds() {
        return [
            'all',
            'major',
            'minor',
            'patch',
            'major-only',
            'minor-only',
            'digest',
            'major-no-digest',
            'minor-no-digest',
            'patch-no-digest',
            'major-only-no-digest',
            'minor-only-no-digest',
        ];
    }

    static parseThresholdWithDigestBehavior(threshold: string | undefined) {
        const thresholdNormalized = (threshold || 'all').toLowerCase();
        const nonDigestOnlySuffix = '-no-digest';
        const nonDigestOnly =
            thresholdNormalized.endsWith(nonDigestOnlySuffix);
        const thresholdBase = nonDigestOnly
            ? thresholdNormalized.slice(
                  0,
                  thresholdNormalized.length - nonDigestOnlySuffix.length,
              )
            : thresholdNormalized;
        return {
            thresholdBase,
            nonDigestOnly,
        };
    }

    /**
     * Return true if update reaches trigger threshold.
     * @param containerResult
     * @param threshold
     * @returns {boolean}
     */
    static isThresholdReached(containerResult: Container, threshold: string) {
        const { thresholdBase, nonDigestOnly } =
            Trigger.parseThresholdWithDigestBehavior(threshold);
        const updateKind = containerResult.updateKind?.kind;
        const semverDiff = containerResult.updateKind?.semverDiff;

        if (nonDigestOnly && updateKind === 'digest') {
            return false;
        }

        if (thresholdBase === 'digest') {
            return updateKind === 'digest';
        }

        if (thresholdBase === 'all') {
            return true;
        }

        if (updateKind === 'tag' && semverDiff && semverDiff !== 'unknown') {
            switch (thresholdBase) {
                case 'major-only':
                    return semverDiff === 'major';
                case 'minor-only':
                    return semverDiff === 'minor';
                case 'minor':
                    return semverDiff !== 'major';
                case 'patch':
                    return semverDiff !== 'major' && semverDiff !== 'minor';
                default:
                    return true;
            }
        }
        return true;
    }

    /**
     * Parse $name:$threshold string.
     * @param {*} includeOrExcludeTriggerString
     * @returns
     */
    static parseIncludeOrIncludeTriggerString(
        includeOrExcludeTriggerString: string,
    ) {
        const includeOrExcludeTriggerSplit =
            includeOrExcludeTriggerString.split(/\s*:\s*/);
        const includeOrExcludeTrigger = {
            id: includeOrExcludeTriggerSplit[0],
            threshold: 'all',
        };
        if (includeOrExcludeTriggerSplit.length === 2) {
            const thresholdCandidate =
                includeOrExcludeTriggerSplit[1].toLowerCase();
            if (
                Trigger.getSupportedThresholds().includes(thresholdCandidate)
            ) {
                includeOrExcludeTrigger.threshold = thresholdCandidate;
            }
        }
        return includeOrExcludeTrigger;
    }

    /**
     * Return true when a trigger reference matches a trigger id.
     * A reference can be either:
     * - full trigger id: docker.update
     * - trigger name only: update
     * @param triggerReference
     * @param triggerId
     */
    static doesReferenceMatchId(triggerReference: string, triggerId: string) {
        const triggerReferenceNormalized = triggerReference.toLowerCase();
        const triggerIdNormalized = triggerId.toLowerCase();

        if (triggerReferenceNormalized === triggerIdNormalized) {
            return true;
        }

        const triggerIdParts = triggerIdNormalized.split('.');
        const triggerName = triggerIdParts[triggerIdParts.length - 1];
        if (triggerReferenceNormalized === triggerName) {
            return true;
        }

        if (triggerIdParts.length >= 2) {
            const providerAndName = `${triggerIdParts[triggerIdParts.length - 2]}.${triggerName}`;
            if (triggerReferenceNormalized === providerAndName) {
                return true;
            }
        }

        return false;
    }

    /**
     * Handle container report (simple mode).
     * @param containerReport
     * @returns {Promise<void>}
     */
    async handleContainerReport(containerReport: ContainerReport) {
        // Filter on changed containers with update available and passing trigger threshold
        if (
            (containerReport.changed || !this.configuration.once) &&
            containerReport.container.updateAvailable
        ) {
            const logContainer =
                this.log.child({
                    container: fullName(containerReport.container),
                }) || this.log;
            let status = 'error';
            try {
                if (
                    !Trigger.isThresholdReached(
                        containerReport.container,
                        (this.configuration.threshold || 'all').toLowerCase(),
                    )
                ) {
                    logContainer.debug('Threshold not reached => ignore');
                } else if (!this.mustTrigger(containerReport.container)) {
                    logContainer.debug('Trigger conditions not met => ignore');
                } else {
                    logContainer.debug('Run');
                    await this.trigger(containerReport.container);
                }
                status = 'success';
            } catch (e: any) {
                logContainer.warn(`Error (${e.message})`);
                logContainer.debug(e);
            } finally {
                getTriggerCounter().inc({
                    type: this.type,
                    name: this.name,
                    status,
                });
            }
        }
    }

    /**
     * Handle container reports (batch mode).
     * @param containerReports
     * @returns {Promise<void>}
     */
    async handleContainerReports(containerReports: ContainerReport[]) {
        // Filter on containers with update available and passing trigger threshold
        try {
            const containerReportsFiltered = containerReports
                .filter(
                    (containerReport) =>
                        containerReport.changed || !this.configuration.once,
                )
                .filter(
                    (containerReport) =>
                        containerReport.container.updateAvailable,
                )
                .filter((containerReport) =>
                    this.mustTrigger(containerReport.container),
                )
                .filter((containerReport) =>
                    Trigger.isThresholdReached(
                        containerReport.container,
                        (this.configuration.threshold || 'all').toLowerCase(),
                    ),
                );
            const containersFiltered = containerReportsFiltered.map(
                (containerReport) => containerReport.container,
            );
            if (containersFiltered.length > 0) {
                this.log.debug('Run batch');
                await this.triggerBatch(containersFiltered);
            }
        } catch (e: any) {
            this.log.warn(`Error (${e.message})`);
            this.log.debug(e);
        }
    }

    isTriggerIncludedOrExcluded(containerResult: Container, trigger: string) {
        const triggerId = this.getId().toLowerCase();
        const triggers = trigger
            .split(/\s*,\s*/)
            .map((triggerToMatch) =>
                Trigger.parseIncludeOrIncludeTriggerString(triggerToMatch),
            );
        const triggerMatched = triggers.find(
            (triggerToMatch) =>
                Trigger.doesReferenceMatchId(triggerToMatch.id, triggerId),
        );
        if (!triggerMatched) {
            return false;
        }
        return Trigger.isThresholdReached(
            containerResult,
            triggerMatched.threshold.toLowerCase(),
        );
    }

    isTriggerIncluded(
        containerResult: Container,
        triggerInclude: string | undefined,
    ) {
        if (!triggerInclude) {
            return true;
        }
        return this.isTriggerIncludedOrExcluded(
            containerResult,
            triggerInclude,
        );
    }

    isTriggerExcluded(
        containerResult: Container,
        triggerExclude: string | undefined,
    ) {
        if (!triggerExclude) {
            return false;
        }
        return this.isTriggerIncludedOrExcluded(
            containerResult,
            triggerExclude,
        );
    }

    /**
     * Return true if must trigger on this container.
     * @param containerResult
     * @returns {boolean}
     */
    mustTrigger(containerResult: Container) {
        if (this.agent && this.agent !== containerResult.agent) {
            return false;
        }
        if (this.strictAgentMatch && this.agent !== containerResult.agent) {
            return false;
        }
        const { triggerInclude, triggerExclude } = containerResult;
        return (
            this.isTriggerIncluded(containerResult, triggerInclude) &&
            !this.isTriggerExcluded(containerResult, triggerExclude)
        );
    }

    /**
     * Init the Trigger.
     */
    async init() {
        await this.initTrigger();
        if (this.configuration.auto) {
            this.log.info(`Registering for auto execution`);
            if (
                this.configuration.mode &&
                this.configuration.mode.toLowerCase() === 'simple'
            ) {
                this.unregisterContainerReport = event.registerContainerReport(
                    async (containerReport) =>
                        this.handleContainerReport(containerReport),
                    {
                        id: this.getId(),
                        order: this.configuration.order,
                    },
                );
            }
            if (
                this.configuration.mode &&
                this.configuration.mode.toLowerCase() === 'batch'
            ) {
                this.unregisterContainerReports = event.registerContainerReports(
                    async (containersReports) =>
                        this.handleContainerReports(containersReports),
                    {
                        id: this.getId(),
                        order: this.configuration.order,
                    },
                );
            }
        } else {
            this.log.info(`Registering for manual execution`);
        }
    }

    async deregisterComponent(): Promise<void> {
        if (this.unregisterContainerReport) {
            this.unregisterContainerReport();
            this.unregisterContainerReport = undefined;
        }
        if (this.unregisterContainerReports) {
            this.unregisterContainerReports();
            this.unregisterContainerReports = undefined;
        }
    }

    /**
     * Override method to merge with common Trigger options (threshold...).
     * @param configuration
     * @returns {*}
     */
    validateConfiguration(
        configuration: TriggerConfiguration,
    ): TriggerConfiguration {
        const schema = this.getConfigurationSchema();
        const schemaWithDefaultOptions = schema.append({
            auto: this.joi.bool().default(true),
            order: this.joi.number().default(100),
            threshold: this.joi
                .string()
                .insensitive()
                .valid(...Trigger.getSupportedThresholds())
                .default('all'),
            mode: this.joi
                .string()
                .insensitive()
                .valid('simple', 'batch')
                .default('simple'),
            once: this.joi.boolean().default(true),
            simpletitle: this.joi
                .string()
                .default(
                    'New ${container.updateKind.kind} found for container ${container.name}',
                ),
            simplebody: this.joi
                .string()
                .default(
                    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
                ),
            batchtitle: this.joi
                .string()
                .default('${containers.length} updates available'),
        });
        const schemaValidated =
            schemaWithDefaultOptions.validate(configuration);
        if (schemaValidated.error) {
            throw schemaValidated.error;
        }
        return schemaValidated.value ? schemaValidated.value : {};
    }

    /**
     * Init Trigger. Can be overridden in trigger implementation class.
     */

    initTrigger() {
        // do nothing by default
    }

    /**
     * Trigger method. Must be overridden in trigger implementation class.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    trigger(containerWithResult: Container) {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container result; this trigger does not implement "simple" mode',
        );
        return containerWithResult;
    }

    /**
     * Trigger batch method. Must be overridden in trigger implementation class.
     * @param containersWithResult
     * @returns {*}
     */
    triggerBatch(containersWithResult: Container[]) {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container results; this trigger does not implement "batch" mode',
        );
        return containersWithResult;
    }

    /**
     * Render trigger title simple.
     * @param container
     * @returns {*}
     */
    renderSimpleTitle(container: Container) {
        return renderSimple(this.configuration.simpletitle!, container);
    }

    /**
     * Render trigger body simple.
     * @param container
     * @returns {*}
     */
    renderSimpleBody(container: Container) {
        return renderSimple(this.configuration.simplebody!, container);
    }

    /**
     * Render trigger title batch.
     * @param containers
     * @returns {*}
     */
    renderBatchTitle(containers: Container[]) {
        return renderBatch(this.configuration.batchtitle!, containers);
    }

    /**
     * Render trigger body batch.
     * @param containers
     * @returns {*}
     */
    renderBatchBody(containers: Container[]) {
        return containers
            .map((container) => `- ${this.renderSimpleBody(container)}\n`)
            .join('\n');
    }
}

export default Trigger;
