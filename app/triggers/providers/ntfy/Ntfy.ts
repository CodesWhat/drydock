import axios, { type AxiosRequestConfig } from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import type { Container } from '../../../model/container.js';
import Trigger, {
  type BatchRuntimeContext,
  getNotificationEvent,
  type TriggerConfiguration,
} from '../Trigger.js';
import { renderSimple } from '../trigger-expression-parser.js';

/**
 * The per-event keys `topics`/`priorities`/action templates can be keyed on.
 * Derived from the notification rule ids the base `Trigger` class dispatches
 * (`update-available`, `update-applied`, `update-failed`, `security-alert`,
 * `container-unhealthy`, `maturity-cleared`, `agent-disconnect`,
 * `agent-reconnect`), stripped of hyphens so each is a single flat env-var
 * segment (`DD_..._TOPICS_UPDATEAVAILABLE` unambiguously maps to
 * `topics.updateavailable`; a hyphen would collide with the underscore used
 * to flatten nested configuration).
 */
const NTFY_EVENT_KEYS = [
  'updateavailable',
  'updateapplied',
  'updatefailed',
  'securityalert',
  'containerunhealthy',
  'maturitycleared',
  'agentdisconnect',
  'agentreconnect',
] as const;
type NtfyEventKey = (typeof NTFY_EVENT_KEYS)[number];

function toNtfyEventKey(ruleId: string): NtfyEventKey {
  return ruleId.replaceAll('-', '') as NtfyEventKey;
}

/**
 * Map a batch runtime context's digest event kind (e.g. `security-alert-digest`)
 * to the notification rule id that `resolveTopic`/`resolvePriority` expect
 * (e.g. `security-alert`). Digest event kinds are always the base rule id
 * suffixed with `-digest`, so stripping the suffix recovers it.
 */
function toRuleIdFromEventKind(eventKind: string): string {
  return eventKind.replace(/-digest$/, '');
}

interface NtfyAction {
  action: 'view' | 'http';
  label: string;
  url: string;
  method?: string;
  body?: string;
  clear?: boolean;
}

interface NtfyConfiguration extends TriggerConfiguration {
  url: string;
  topic?: string;
  priority?: number;
  topics?: Partial<Record<NtfyEventKey, string>>;
  priorities?: Partial<Record<NtfyEventKey, number>>;
  actions?: NtfyAction[];
  auth?: {
    user?: string;
    password?: string;
    token?: string;
  };
}

/**
 * Ntfy Trigger implementation
 */
class Ntfy extends Trigger<NtfyConfiguration> {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      url: this.joi
        .string()
        .uri({
          scheme: ['http', 'https'],
        })
        .default('https://ntfy.sh'),
      topic: this.joi.string(),
      priority: this.joi.number().integer().min(0).max(5),
      topics: this.joi.object().keys({
        updateavailable: this.joi.string(),
        updateapplied: this.joi.string(),
        updatefailed: this.joi.string(),
        securityalert: this.joi.string(),
        containerunhealthy: this.joi.string(),
        maturitycleared: this.joi.string(),
        agentdisconnect: this.joi.string(),
        agentreconnect: this.joi.string(),
      }),
      priorities: this.joi.object().keys({
        updateavailable: this.joi.number().integer().min(0).max(5),
        updateapplied: this.joi.number().integer().min(0).max(5),
        updatefailed: this.joi.number().integer().min(0).max(5),
        securityalert: this.joi.number().integer().min(0).max(5),
        containerunhealthy: this.joi.number().integer().min(0).max(5),
        maturitycleared: this.joi.number().integer().min(0).max(5),
        agentdisconnect: this.joi.number().integer().min(0).max(5),
        agentreconnect: this.joi.number().integer().min(0).max(5),
      }),
      actions: this.joi
        .array()
        .max(3)
        .items(
          this.joi.object({
            action: this.joi.string().valid('view', 'http').required(),
            label: this.joi.string().required(),
            url: this.joi.string().required(),
            method: this.joi.string(),
            body: this.joi.string(),
            clear: this.joi.boolean(),
          }),
        ),
      auth: this.joi.object({
        user: this.joi.string(),
        password: this.joi.string(),
        token: this.joi.string(),
      }),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      ...this.configuration,
      auth: this.configuration.auth
        ? {
            user: Ntfy.mask(this.configuration.auth.user),
            password: Ntfy.mask(this.configuration.auth.password),
            token: Ntfy.mask(this.configuration.auth.token),
          }
        : undefined,
    };
  }

  /**
   * Resolve the topic for an event kind, falling back to the static `topic`.
   * @param ruleId the notification rule id (e.g. `update-available`)
   * @returns {string|undefined}
   */
  resolveTopic(ruleId: string): string | undefined {
    return this.configuration.topics?.[toNtfyEventKey(ruleId)] ?? this.configuration.topic;
  }

  /**
   * Resolve the priority for an event kind, falling back to the static `priority`.
   * @param ruleId the notification rule id (e.g. `update-available`)
   * @returns {number|undefined}
   */
  resolvePriority(ruleId: string): number | undefined {
    return this.configuration.priorities?.[toNtfyEventKey(ruleId)] ?? this.configuration.priority;
  }

  /**
   * Render the configured action buttons against a container, so `$`-style
   * template expressions in `label`/`url`/`body` resolve the same way
   * `simpletitle`/`simplebody` do.
   * @param container the container providing template variables
   * @returns {*}
   */
  renderActions(container: Container) {
    if (!this.configuration.actions?.length) {
      return undefined;
    }
    const templateContainer = this.getTemplateContainer(container);
    return this.configuration.actions.map((action) => ({
      action: action.action,
      label: renderSimple(action.label, templateContainer),
      url: renderSimple(action.url, templateContainer),
      ...(action.method ? { method: action.method } : {}),
      ...(action.body ? { body: renderSimple(action.body, templateContainer) } : {}),
      ...(action.clear !== undefined ? { clear: action.clear } : {}),
    }));
  }

  /**
   * Send an HTTP Request to Ntfy.
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container: Container) {
    const ruleId = getNotificationEvent(container)?.kind ?? 'update-available';
    return this.sendHttpRequest({
      topic: this.resolveTopic(ruleId),
      title: this.renderSimpleTitle(container),
      message: this.renderSimpleBody(container),
      priority: this.resolvePriority(ruleId),
      actions: this.renderActions(container),
    });
  }

  /**
   * Send an HTTP Request to Ntfy.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers: Container[], runtimeContext?: BatchRuntimeContext) {
    const ruleId = runtimeContext?.eventKind
      ? toRuleIdFromEventKind(runtimeContext.eventKind)
      : containers.length > 0
        ? (getNotificationEvent(containers[0])?.kind ?? 'update-available')
        : 'update-available';
    return this.sendHttpRequest({
      topic: this.resolveTopic(ruleId),
      title: this.renderBatchTitle(containers, runtimeContext),
      message: this.renderBatchBody(containers, runtimeContext),
      priority: this.resolvePriority(ruleId),
      actions: containers.length > 0 ? this.renderActions(containers[0]) : undefined,
    });
  }

  /**
   * Send http request to Ntfy.
   * @param body
   * @returns {Promise<*>}
   */
  async sendHttpRequest(body) {
    const auth = this.configuration.auth;
    const options: AxiosRequestConfig = {
      method: 'POST',
      url: this.configuration.url,
      headers: {
        'Content-Type': 'application/json',
      },
      data: body,
      timeout: getOutboundHttpTimeoutMs(),
    };
    if (auth?.user && auth?.password) {
      options.auth = {
        username: auth.user,
        password: auth.password,
      };
    }
    if (auth?.token) {
      options.headers.Authorization = `Bearer ${auth.token}`;
    }
    const response = await axios(options);
    return response.data;
  }
}

export default Ntfy;
