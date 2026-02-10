import Component, { ComponentConfiguration } from '../../registry/Component.js';
import * as event from '../../event/index.js';
import { registerContainerUpdateApplied } from '../../event/index.js';
import { getTriggerCounter } from '../../prometheus/trigger.js';
import { fullName, Container } from '../../model/container.js';

export interface TriggerConfiguration extends ComponentConfiguration {
    auto?: boolean;
    order?: number;
    threshold?: string;
    mode?: string;
    once?: boolean;
    simpletitle?: string;
    simplebody?: string;
    batchtitle?: string;
    resolvenotifications?: boolean;
}

export interface ContainerReport {
    container: Container;
    changed: boolean;
}

/**
 * Safely resolve a dotted property path on an object.
 * Returns undefined when any segment along the path is nullish.
 */
function resolvePath(obj: any, path: string): any {
    return path.split('.').reduce((cur, key) => {
        if (cur == null) return undefined;
        return cur[key];
    }, obj);
}

/**
 * Safely evaluate a template expression against a known set of variables.
 *
 * Supported expression forms (all other syntax is returned as-is):
 *   - property paths:    container.updateKind.kind
 *   - method calls:      local.substring(0, 15)
 *   - logical AND:       a && b            (returns b when both truthy)
 *   - ternary:           a ? b : c
 *   - string literals:   "hello"  or  "hello" + var
 *   - string concat:     expr + expr
 */
function safeEvalExpr(
    expr: string,
    vars: Record<string, any>,
): string {
    const trimmed = expr.trim();

    // --- ternary: condition ? consequent : alternate ---
    // Find the top-level '?' that is not inside quotes or parens
    const ternaryIdx = findTopLevel(trimmed, '?');
    if (ternaryIdx !== -1) {
        const condition = trimmed.slice(0, ternaryIdx);
        const rest = trimmed.slice(ternaryIdx + 1);
        const colonIdx = findTopLevel(rest, ':');
        if (colonIdx !== -1) {
            const consequent = rest.slice(0, colonIdx);
            const alternate = rest.slice(colonIdx + 1);
            const condVal = safeEvalExpr(condition, vars);
            return condVal
                ? String(safeEvalExpr(consequent, vars))
                : String(safeEvalExpr(alternate, vars));
        }
    }

    // --- logical AND: a && b ---
    const andIdx = findTopLevel(trimmed, '&&');
    if (andIdx !== -1) {
        const left = trimmed.slice(0, andIdx);
        const right = trimmed.slice(andIdx + 2);
        const leftVal = safeEvalExpr(left, vars);
        if (!leftVal) return leftVal;
        return safeEvalExpr(right, vars);
    }

    // --- string concatenation with + ---
    const plusIdx = findTopLevelPlus(trimmed);
    if (plusIdx !== -1) {
        const left = trimmed.slice(0, plusIdx);
        const right = trimmed.slice(plusIdx + 1);
        return String(safeEvalExpr(left, vars)) + String(safeEvalExpr(right, vars));
    }

    // --- string literal: "..." ---
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed
            .slice(1, -1)
            .replace(/\\n/g, '\n')
            .replace(/\\t/g, '\t')
            .replace(/\\"/g, '"')
            .replace(/\\'/g, "'");
    }

    // --- number literal ---
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed) as any;
    }

    // --- method call: path.method(args) ---
    const methodMatch = trimmed.match( // NOSONAR - regex operates on bounded template expressions, not arbitrary user input
        /^([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*?)\.([a-zA-Z_]\w*)\(([^)]*)\)$/,
    );
    if (methodMatch) {
        const objPath = methodMatch[1];
        const method = methodMatch[2];
        const rawArgs = methodMatch[3];
        const target = safeEvalExpr(objPath, vars);
        if (target != null && typeof target[method] === 'function') {
            // Only allow safe string/array methods
            const allowedMethods = [
                'substring',
                'slice',
                'toLowerCase',
                'toUpperCase',
                'trim',
                'trimStart',
                'trimEnd',
                'replace',
                'split',
                'indexOf',
                'lastIndexOf',
                'startsWith',
                'endsWith',
                'includes',
                'charAt',
                'padStart',
                'padEnd',
                'repeat',
                'toString',
            ];
            if (!allowedMethods.includes(method)) {
                return '';
            }
            const args = rawArgs
                ? rawArgs.split(',').map((a: string) => safeEvalExpr(a, vars))
                : [];
            return target[method](...args);
        }
        return '';
    }

    // --- simple property path: container.updateKind.kind ---
    if (/^[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)*$/.test(trimmed)) {
        const val = resolvePath(vars, trimmed);
        return val != null ? val : '';
    }

    // Unsupported expression – return empty string for safety
    return '';
}

/**
 * Find the index of a top-level operator (not inside quotes or parentheses).
 */
function findTopLevel(str: string, op: string): number {
    let depth = 0;
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (inDouble || inSingle) continue;
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0 && str.slice(i, i + op.length) === op) {
            return i;
        }
    }
    return -1;
}

/**
 * Find the index of a top-level '+' that is not part of '++' and is not
 * inside quotes or parentheses. Skips '+' that looks like a numeric sign
 * after another operator.
 */
function findTopLevelPlus(str: string): number {
    let depth = 0;
    let inDouble = false;
    let inSingle = false;
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (ch === '\\') {
            i++;
            continue;
        }
        if (ch === '"' && !inSingle) {
            inDouble = !inDouble;
            continue;
        }
        if (ch === "'" && !inDouble) {
            inSingle = !inSingle;
            continue;
        }
        if (inDouble || inSingle) continue;
        if (ch === '(') depth++;
        if (ch === ')') depth--;
        if (depth === 0 && ch === '+' && str[i + 1] !== '+') {
            // Make sure there is a non-whitespace token on the left
            const left = str.slice(0, i).trim();
            if (left.length > 0) {
                return i;
            }
        }
    }
    return -1;
}

/**
 * Safely interpolate a template string with ${...} placeholders.
 * Replaces eval()-based template literal evaluation with a secure approach.
 */
function safeInterpolate(
    template: string | undefined,
    vars: Record<string, any>,
): string {
    if (template == null) {
        return '';
    }
    // Match ${...} placeholders, handling nested braces
    return template.replace(/\$\{([^}]+)\}/g, (_, expr) => {
        const result = safeEvalExpr(expr, vars);
        return result != null ? String(result) : '';
    });
}

/**
 * Render body or title simple template.
 * @param template
 * @param container
 * @returns {*}
 */
function renderSimple(template: string, container: Container) {
    const vars: Record<string, any> = {
        container,
        // Deprecated vars for backward compatibility
        id: container.id,
        name: container.name,
        watcher: container.watcher,
        kind:
            container.updateKind && container.updateKind.kind
                ? container.updateKind.kind
                : '',
        semver:
            container.updateKind && container.updateKind.semverDiff
                ? container.updateKind.semverDiff
                : '',
        local:
            container.updateKind && container.updateKind.localValue
                ? container.updateKind.localValue
                : '',
        remote:
            container.updateKind && container.updateKind.remoteValue
                ? container.updateKind.remoteValue
                : '',
        link:
            container.result && container.result.link
                ? container.result.link
                : '',
    };
    return safeInterpolate(template, vars);
}

function renderBatch(template: string, containers: Container[]) {
    const vars: Record<string, any> = {
        containers,
        // Deprecated var for backward compatibility
        count: containers ? containers.length : 0,
    };
    return safeInterpolate(template, vars);
}

/**
 * Trigger base component.
 */
class Trigger extends Component {
    public configuration: TriggerConfiguration = {};
    public strictAgentMatch = false;
    private unregisterContainerReport?: () => void;
    private unregisterContainerReports?: () => void;
    private unregisterContainerUpdateApplied?: () => void;
    private readonly notificationResults: Map<string, any> = new Map();

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
                    const result = await this.trigger(containerReport.container);
                    if (this.configuration.resolvenotifications && result) {
                        this.notificationResults.set(
                            fullName(containerReport.container),
                            result,
                        );
                    }
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
        if (this.configuration.resolvenotifications) {
            this.log.info('Registering for notification resolution');
            this.unregisterContainerUpdateApplied =
                registerContainerUpdateApplied(
                    async (containerId) =>
                        this.handleContainerUpdateApplied(containerId),
                );
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
        if (this.unregisterContainerUpdateApplied) {
            this.unregisterContainerUpdateApplied();
            this.unregisterContainerUpdateApplied = undefined;
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
            resolvenotifications: this.joi.boolean().default(false),
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
    async trigger(containerWithResult: Container) {
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
    async triggerBatch(containersWithResult: Container[]) {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container results; this trigger does not implement "batch" mode',
        );
        return containersWithResult;
    }

    /**
     * Handle container update applied event.
     * Dismiss the stored notification for the updated container.
     * @param containerId
     */
    async handleContainerUpdateApplied(containerId: string) {
        const triggerResult = this.notificationResults.get(containerId);
        if (!triggerResult) {
            return;
        }
        try {
            this.log.info(
                `Dismissing notification for container ${containerId}`,
            );
            await this.dismiss(containerId, triggerResult);
        } catch (e: any) {
            this.log.warn(
                `Error dismissing notification for container ${containerId} (${e.message})`,
            );
            this.log.debug(e);
        } finally {
            this.notificationResults.delete(containerId);
        }
    }

    /**
     * Dismiss a previously sent notification.
     * Override in trigger implementations that support notification deletion.
     * @param containerId the container identifier
     * @param triggerResult the result returned by trigger() when the notification was sent
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async dismiss(containerId: string, triggerResult: any): Promise<void> {
        // do nothing by default
    }

    /**
     * Compose a single-container message with optional title.
     * Providers needing custom formatting should override formatTitleAndBody().
     */
    protected composeMessage(container: Container): string {
        const body = this.renderSimpleBody(container);
        if ((this.configuration as any).disabletitle) {
            return body;
        }
        const title = this.renderSimpleTitle(container);
        return this.formatTitleAndBody(title, body);
    }

    /**
     * Compose a batch message with optional title.
     * Providers needing custom formatting should override formatTitleAndBody().
     */
    protected composeBatchMessage(containers: Container[]): string {
        const body = this.renderBatchBody(containers);
        if ((this.configuration as any).disabletitle) {
            return body;
        }
        const title = this.renderBatchTitle(containers);
        return this.formatTitleAndBody(title, body);
    }

    /**
     * Format title and body into a single message string.
     * Override in subclasses for custom formatting (e.g. bold, markdown).
     */
    protected formatTitleAndBody(title: string, body: string): string {
        return `${title}\n\n${body}`;
    }

    /**
     * Mask the specified fields in the configuration, returning a copy.
     * For simple flat-field masking; providers with nested fields should
     * override maskConfiguration() directly.
     */
    protected maskFields(fieldsToMask: string[]): Record<string, any> {
        const masked = { ...this.configuration };
        for (const field of fieldsToMask) {
            if ((masked as any)[field]) {
                (masked as any)[field] = (this.constructor as typeof Trigger).mask((masked as any)[field]);
            }
        }
        return masked;
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
