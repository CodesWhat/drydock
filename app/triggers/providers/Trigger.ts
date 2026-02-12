import * as event from '../../event/index.js';
import { registerContainerUpdateApplied } from '../../event/index.js';
import { type Container, fullName } from '../../model/container.js';
import { getTriggerCounter } from '../../prometheus/trigger.js';
import Component, { type ComponentConfiguration } from '../../registry/Component.js';

export interface TriggerConfiguration extends ComponentConfiguration {
  auto?: boolean;
  order?: number;
  threshold?: string;
  mode?: string;
  once?: boolean;
  disabletitle?: boolean;
  simpletitle?: string;
  simplebody?: string;
  batchtitle?: string;
  resolvenotifications?: boolean;
}

export interface ContainerReport {
  container: Container;
  changed: boolean;
}

type TemplateVars = Record<string, unknown>;

/**
 * Safely resolve a dotted property path on an object.
 * Returns undefined when any segment along the path is nullish.
 */
function resolvePath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((cur, key) => {
    if (cur == null) return undefined;
    return Reflect.get(Object(cur), key);
  }, obj);
}

/** Simple identifier segment test — no nested groups, linear time. */
const IDENT_RE = /^[a-zA-Z_]\w*$/;

/**
 * Validate a dotted property path (e.g. "container.updateKind.kind")
 * by splitting on '.' and checking each segment individually.
 * This avoids a regex with nested repetition that is vulnerable to ReDoS.
 */
function isValidPropertyPath(str: string): boolean {
  const parts = str.split('.');
  return parts.length > 0 && parts.every((p) => IDENT_RE.test(p));
}

/**
 * Parse a method call expression like "obj.path.method(args)" by splitting
 * on the parentheses and the last dot, rather than using a single complex regex.
 * Returns null if the string is not a valid method call expression.
 */
function parseMethodCall(str: string): { objPath: string; method: string; rawArgs: string } | null {
  // Must end with ')' and contain '('
  if (!str.endsWith(')')) return null;
  const openParen = str.indexOf('(');
  if (openParen === -1) return null;

  const rawArgs = str.slice(openParen + 1, -1);
  // Args must not contain unmatched parens (original regex used [^)]*)
  if (rawArgs.includes(')')) return null;

  const pathPart = str.slice(0, openParen);
  // Split on last '.' to separate object path from method name
  const lastDot = pathPart.lastIndexOf('.');
  if (lastDot === -1) return null;

  const objPath = pathPart.slice(0, lastDot);
  const method = pathPart.slice(lastDot + 1);

  // Validate that objPath is a valid dotted identifier path and method is an identifier
  if (!isValidPropertyPath(objPath) || !IDENT_RE.test(method)) return null;

  return { objPath, method, rawArgs };
}

/** Allowed safe string/array methods for template expressions. */
const ALLOWED_METHODS = new Set([
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
]);

function evalTernary(trimmed: string, vars: TemplateVars): unknown | undefined {
  const ternaryIdx = findTopLevelOperator(trimmed, isOperator('?'));
  if (ternaryIdx === -1) return undefined;
  const condition = trimmed.slice(0, ternaryIdx);
  const rest = trimmed.slice(ternaryIdx + 1);
  const colonIdx = findTopLevelOperator(rest, isOperator(':'));
  if (colonIdx === -1) return undefined;
  const consequent = rest.slice(0, colonIdx);
  const alternate = rest.slice(colonIdx + 1);
  const condVal = safeEvalExpr(condition, vars);
  return condVal ? safeEvalExpr(consequent, vars) : safeEvalExpr(alternate, vars);
}

function evalLogicalAnd(trimmed: string, vars: TemplateVars): unknown | undefined {
  const andIdx = findTopLevelOperator(trimmed, isOperator('&&'));
  if (andIdx === -1) return undefined;
  const left = trimmed.slice(0, andIdx);
  const right = trimmed.slice(andIdx + 2);
  const leftVal = safeEvalExpr(left, vars);
  if (!leftVal) return leftVal;
  return safeEvalExpr(right, vars);
}

function evalConcat(trimmed: string, vars: TemplateVars): string | undefined {
  const plusIdx = findTopLevelOperator(trimmed, isPlusOperator);
  if (plusIdx === -1) return undefined;
  const left = trimmed.slice(0, plusIdx);
  const right = trimmed.slice(plusIdx + 1);
  return String(safeEvalExpr(left, vars)) + String(safeEvalExpr(right, vars));
}

function evalStringLiteral(trimmed: string): string | undefined {
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed
      .slice(1, -1)
      .replaceAll(String.raw`\n`, '\n')
      .replaceAll(String.raw`\t`, '\t')
      .replaceAll(String.raw`\"`, '"')
      .replaceAll(String.raw`\'`, "'");
  }
  return undefined;
}

function evalNumberLiteral(trimmed: string): string | undefined {
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return String(Number(trimmed));
  }
  return undefined;
}

function evalMethodCall(trimmed: string, vars: TemplateVars): unknown | undefined {
  const methodMatch = parseMethodCall(trimmed);
  if (!methodMatch) return undefined;
  const { objPath, method, rawArgs } = methodMatch;
  const target = safeEvalExpr(objPath, vars);
  if (target == null || !ALLOWED_METHODS.has(method)) {
    return '';
  }
  const methodFn = Reflect.get(Object(target), method);
  if (typeof methodFn !== 'function') {
    return '';
  }
  const args: unknown[] = rawArgs?.split(',').map((a: string) => safeEvalExpr(a, vars)) ?? [];
  return methodFn.apply(target, args);
}

function evalPropertyPath(trimmed: string, vars: TemplateVars): unknown | undefined {
  if (isValidPropertyPath(trimmed)) {
    const val = resolvePath(vars, trimmed);
    return val ?? '';
  }
  return undefined;
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
function safeEvalExpr(expr: string, vars: TemplateVars): unknown {
  const trimmed = expr.trim();
  const ternary = evalTernary(trimmed, vars);
  if (ternary !== undefined) return ternary;
  const logicalAnd = evalLogicalAnd(trimmed, vars);
  if (logicalAnd !== undefined) return logicalAnd;
  const concat = evalConcat(trimmed, vars);
  if (concat !== undefined) return concat;
  const stringLiteral = evalStringLiteral(trimmed);
  if (stringLiteral !== undefined) return stringLiteral;
  const numberLiteral = evalNumberLiteral(trimmed);
  if (numberLiteral !== undefined) return numberLiteral;
  const methodCall = evalMethodCall(trimmed, vars);
  if (methodCall !== undefined) return methodCall;
  const propertyPath = evalPropertyPath(trimmed, vars);
  if (propertyPath !== undefined) return propertyPath;

  // Unsupported expression – return empty string for safety
  return '';
}

/**
 * Predicate factory for matching a fixed operator string at position i.
 */
function isOperator(op: string): (str: string, i: number) => boolean {
  return (str, i) => str.slice(i, i + op.length) === op;
}

/**
 * Predicate for matching a top-level '+' that is not part of '++' and has
 * a non-whitespace token on the left (i.e. not a unary plus / numeric sign).
 */
function isPlusOperator(str: string, i: number): boolean {
  if (str[i] !== '+' || str[i + 1] === '+') return false;
  const left = str.slice(0, i).trim();
  return left.length > 0;
}

function isEscapeCharacter(ch: string): boolean {
  return ch === '\\';
}

function toggleQuoteState(
  ch: string,
  inDouble: boolean,
  inSingle: boolean,
): { inDouble: boolean; inSingle: boolean; didToggle: boolean } {
  if (ch === '"' && !inSingle) {
    return { inDouble: !inDouble, inSingle, didToggle: true };
  }
  if (ch === "'" && !inDouble) {
    return { inDouble, inSingle: !inSingle, didToggle: true };
  }
  return { inDouble, inSingle, didToggle: false };
}

function updateParenDepth(depth: number, ch: string): number {
  if (ch === '(') return depth + 1;
  if (ch === ')') return depth - 1;
  return depth;
}

type TopLevelOperatorScanState = {
  depth: number;
  inDouble: boolean;
  inSingle: boolean;
};

function updateQuoteStateAndCheckInsideQuote(
  ch: string,
  state: TopLevelOperatorScanState,
): boolean {
  const quoteState = toggleQuoteState(ch, state.inDouble, state.inSingle);
  state.inDouble = quoteState.inDouble;
  state.inSingle = quoteState.inSingle;
  return quoteState.didToggle || state.inDouble || state.inSingle;
}

function isTopLevelPredicateMatch(
  str: string,
  i: number,
  predicate: (str: string, i: number) => boolean,
  state: TopLevelOperatorScanState,
): boolean {
  state.depth = updateParenDepth(state.depth, str[i]);
  return state.depth === 0 && predicate(str, i);
}

function scanTopLevelOperatorStep(
  str: string,
  i: number,
  predicate: (str: string, i: number) => boolean,
  state: TopLevelOperatorScanState,
): { found: boolean; skipNext: boolean } {
  const ch = str[i];
  if (isEscapeCharacter(ch)) {
    return { found: false, skipNext: true };
  }

  if (updateQuoteStateAndCheckInsideQuote(ch, state)) {
    return { found: false, skipNext: false };
  }

  return {
    found: isTopLevelPredicateMatch(str, i, predicate, state),
    skipNext: false,
  };
}

/**
 * Find the index of a top-level operator (not inside quotes or parentheses)
 * that satisfies the given predicate.
 */
function findTopLevelOperator(str: string, predicate: (str: string, i: number) => boolean): number {
  const state: TopLevelOperatorScanState = { depth: 0, inDouble: false, inSingle: false };
  let skipNext = false;
  for (let i = 0; i < str.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }
    const step = scanTopLevelOperatorStep(str, i, predicate, state);
    if (step.found) {
      return i;
    }
    skipNext = step.skipNext;
  }
  return -1;
}

/**
 * Safely interpolate a template string with ${...} placeholders.
 * Replaces eval()-based template literal evaluation with a secure approach.
 */
function safeInterpolate(template: string | undefined, vars: TemplateVars): string {
  if (template == null) {
    return '';
  }
  // Match ${...} placeholders, handling nested braces
  return template.replaceAll(/\$\{([^}]+)\}/g, (_, expr) => {
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
  const vars: TemplateVars = {
    container,
    // Deprecated vars for backward compatibility
    id: container.id,
    name: container.name,
    watcher: container.watcher,
    kind: container.updateKind?.kind ?? '',
    semver: container.updateKind?.semverDiff ?? '',
    local: container.updateKind?.localValue ?? '',
    remote: container.updateKind?.remoteValue ?? '',
    link: container.result?.link ?? '',
  };
  return safeInterpolate(template, vars);
}

function renderBatch(template: string, containers: Container[]) {
  const vars: TemplateVars = {
    containers,
    // Deprecated var for backward compatibility
    count: containers.length,
  };
  return safeInterpolate(template, vars);
}

function splitAndTrimCommaSeparatedList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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
    const thresholdNormalized = (threshold ?? 'all').toLowerCase();
    const nonDigestOnlySuffix = '-no-digest';
    const nonDigestOnly = thresholdNormalized.endsWith(nonDigestOnlySuffix);
    const thresholdBase = nonDigestOnly
      ? thresholdNormalized.slice(0, thresholdNormalized.length - nonDigestOnlySuffix.length)
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
    const { thresholdBase, nonDigestOnly } = Trigger.parseThresholdWithDigestBehavior(threshold);
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
  static parseIncludeOrIncludeTriggerString(includeOrExcludeTriggerString: string) {
    const hasThresholdSeparator = includeOrExcludeTriggerString.includes(':');
    const separatorIndex = hasThresholdSeparator ? includeOrExcludeTriggerString.indexOf(':') : -1;
    const hasMultipleSeparators =
      hasThresholdSeparator && includeOrExcludeTriggerString.slice(separatorIndex + 1).includes(':');

    const triggerId = hasThresholdSeparator
      ? includeOrExcludeTriggerString.slice(0, separatorIndex).trim()
      : includeOrExcludeTriggerString.trim();
    const includeOrExcludeTrigger = {
      id: triggerId,
      threshold: 'all',
    };

    if (hasThresholdSeparator && !hasMultipleSeparators) {
      const thresholdCandidate = includeOrExcludeTriggerString
        .slice(separatorIndex + 1)
        .trim()
        .toLowerCase();
      if (Trigger.getSupportedThresholds().includes(thresholdCandidate)) {
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
    const triggerName = triggerIdParts.at(-1);
    if (!triggerName) {
      return false;
    }
    if (triggerReferenceNormalized === triggerName) {
      return true;
    }

    if (triggerIdParts.length >= 2) {
      const provider = triggerIdParts.at(-2);
      const providerAndName = `${provider}.${triggerName}`;
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
        const thresholdReached = Trigger.isThresholdReached(
          containerReport.container,
          (this.configuration.threshold ?? 'all').toLowerCase(),
        );
        if (!thresholdReached) {
          logContainer.debug('Threshold not reached => ignore');
        } else if (!this.mustTrigger(containerReport.container)) {
          logContainer.debug('Trigger conditions not met => ignore');
        } else {
          logContainer.debug('Run');
          const result = await this.trigger(containerReport.container);
          if (this.configuration.resolvenotifications && result) {
            this.notificationResults.set(fullName(containerReport.container), result);
          }
        }
        status = 'success';
      } catch (e: any) {
        logContainer.warn(`Error (${e.message})`);
        logContainer.debug(e);
      } finally {
        getTriggerCounter()?.inc({
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
        .filter((containerReport) => containerReport.changed || !this.configuration.once)
        .filter((containerReport) => containerReport.container.updateAvailable)
        .filter((containerReport) => this.mustTrigger(containerReport.container))
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
    const triggers = splitAndTrimCommaSeparatedList(trigger)
      .map((triggerToMatch) => Trigger.parseIncludeOrIncludeTriggerString(triggerToMatch));
    const triggerMatched = triggers.find((triggerToMatch) =>
      Trigger.doesReferenceMatchId(triggerToMatch.id, triggerId),
    );
    if (!triggerMatched) {
      return false;
    }
    return Trigger.isThresholdReached(containerResult, triggerMatched.threshold.toLowerCase());
  }

  isTriggerIncluded(containerResult: Container, triggerInclude: string | undefined) {
    if (!triggerInclude) {
      return true;
    }
    return this.isTriggerIncludedOrExcluded(containerResult, triggerInclude);
  }

  isTriggerExcluded(containerResult: Container, triggerExclude: string | undefined) {
    if (!triggerExclude) {
      return false;
    }
    return this.isTriggerIncludedOrExcluded(containerResult, triggerExclude);
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
      if (this.configuration.mode?.toLowerCase() === 'simple') {
        this.unregisterContainerReport = event.registerContainerReport(
          async (containerReport) => this.handleContainerReport(containerReport),
          {
            id: this.getId(),
            order: this.configuration.order,
          },
        );
      }
      if (this.configuration.mode?.toLowerCase() === 'batch') {
        this.unregisterContainerReports = event.registerContainerReports(
          async (containersReports) => this.handleContainerReports(containersReports),
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
      this.unregisterContainerUpdateApplied = registerContainerUpdateApplied(async (containerId) =>
        this.handleContainerUpdateApplied(containerId),
      );
    }
  }

  async deregisterComponent(): Promise<void> {
    this.unregisterContainerReport?.();
    this.unregisterContainerReport = undefined;

    this.unregisterContainerReports?.();
    this.unregisterContainerReports = undefined;

    this.unregisterContainerUpdateApplied?.();
    this.unregisterContainerUpdateApplied = undefined;
  }

  /**
   * Override method to merge with common Trigger options (threshold...).
   * @param configuration
   * @returns {*}
   */
  validateConfiguration(configuration: TriggerConfiguration): TriggerConfiguration {
    const schema = this.getConfigurationSchema();
    const schemaWithDefaultOptions = schema.append({
      auto: this.joi.bool().default(true),
      order: this.joi.number().default(100),
      threshold: this.joi
        .string()
        .insensitive()
        .valid(...Trigger.getSupportedThresholds())
        .default('all'),
      mode: this.joi.string().insensitive().valid('simple', 'batch').default('simple'),
      once: this.joi.boolean().default(true),
      simpletitle: this.joi
        .string()
        .default('New ${container.updateKind.kind} found for container ${container.name}'),
      simplebody: this.joi
        .string()
        .default(
          'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
        ),
      batchtitle: this.joi.string().default('${containers.length} updates available'),
      resolvenotifications: this.joi.boolean().default(false),
    });
    const schemaValidated = schemaWithDefaultOptions.validate(configuration);
    if (schemaValidated.error) {
      throw schemaValidated.error;
    }
    return schemaValidated.value ? schemaValidated.value : {};
  }

  /**
   * Init Trigger. Can be overridden in trigger implementation class.
   */

  initTrigger(): void | Promise<void> {
    // do nothing by default
  }

  /**
   * Preview what an update would do without performing it.
   * Can be overridden in trigger implementation class.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async preview(container: Container): Promise<Record<string, any>> {
    return {};
  }

  /**
   * Trigger method. Must be overridden in trigger implementation class.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async trigger(containerWithResult: Container) {
    // do nothing by default
    this.log.warn('Cannot trigger container result; this trigger does not implement "simple" mode');
    return containerWithResult;
  }

  /**
   * Trigger batch method. Must be overridden in trigger implementation class.
   * @param containersWithResult
   * @returns {*}
   */
  async triggerBatch(containersWithResult: Container[]) {
    // do nothing by default
    this.log.warn('Cannot trigger container results; this trigger does not implement "batch" mode');
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
      this.log.info(`Dismissing notification for container ${containerId}`);
      await this.dismiss(containerId, triggerResult);
    } catch (e: any) {
      this.log.warn(`Error dismissing notification for container ${containerId} (${e.message})`);
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
    if (this.configuration.disabletitle) {
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
    if (this.configuration.disabletitle) {
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
    const masked: Record<string, any> = { ...this.configuration };
    for (const field of fieldsToMask) {
      if (masked[field]) {
        masked[field] = (this.constructor as typeof Trigger).mask(masked[field]);
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
    return containers.map((container) => `- ${this.renderSimpleBody(container)}\n`).join('\n');
  }
}

export default Trigger;
