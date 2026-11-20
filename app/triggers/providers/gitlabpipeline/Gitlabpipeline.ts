import {
  buildRebuildPayload,
  buildRebuildRequestOptions,
  maskProxyUrl,
  REBUILD_EVENT,
  selectRebuildContainers,
  sendRebuildRequest,
} from '../ci-rebuild-shared.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface GitlabpipelineConfiguration extends TriggerConfiguration {
  project: string;
  token: string;
  ref: string;
  url: string;
  variables?: Record<string, string>;
  baseimageonly: boolean;
  proxy?: string;
  insecure: boolean;
}

/**
 * GitLab pipeline trigger: asks a project pipeline to rebuild a locally built
 * image when its upstream base image has a newer tag.
 */
class Gitlabpipeline extends Trigger<GitlabpipelineConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      project: this.joi
        .alternatives()
        .try(this.joi.string().pattern(/^\d+$/), this.joi.string().pattern(/^[^\s/][^\s]*$/))
        .required(),
      token: this.joi.string().required(),
      ref: this.joi.string().default('main'),
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .default('https://gitlab.com'),
      variables: this.joi.object().pattern(/^[A-Za-z_][A-Za-z0-9_]*$/, this.joi.string().allow('')),
      baseimageonly: this.joi.boolean().default(true),
      proxy: this.joi.string().uri({ scheme: ['http', 'https'] }),
      insecure: this.joi.boolean().default(false),
    });
  }

  maskConfiguration() {
    const masked = this.maskFields(['token']);
    if (typeof masked.proxy === 'string') {
      masked.proxy = maskProxyUrl(masked.proxy);
    }
    if (masked.variables) {
      // Configured variables often carry deploy keys or registry passwords.
      masked.variables = Object.fromEntries(
        Object.entries(masked.variables).map(([key, value]) => [
          key,
          Gitlabpipeline.mask(value) ?? value,
        ]),
      );
    }
    return masked;
  }

  async trigger(container) {
    return this.dispatch([container]);
  }

  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    if (runtimeContext?.eventKind === 'security-alert-digest') {
      return undefined;
    }
    return this.dispatch(containers);
  }

  private async dispatch(containers) {
    const selected = selectRebuildContainers(containers, this.configuration.baseimageonly ?? true);
    if (selected.length === 0) {
      this.log.debug('No base image update of a locally built image to dispatch');
      return undefined;
    }
    const label = `GitLab pipeline trigger ${this.getId()}`;
    const payload = buildRebuildPayload(selected);
    const form = new URLSearchParams();
    form.set('token', this.configuration.token);
    form.set('ref', this.configuration.ref);
    for (const [key, value] of Object.entries(this.configuration.variables ?? {})) {
      form.set(`variables[${key.toUpperCase()}]`, value);
    }
    form.set('variables[DD_EVENT]', REBUILD_EVENT);
    form.set('variables[DD_CONTAINER_COUNT]', `${payload.count}`);
    form.set('variables[DD_CONTAINER_NAMES]', payload.containers.map((c) => c.name).join(','));
    form.set('variables[DD_PAYLOAD]', JSON.stringify(payload));
    if (payload.containers.length === 1) {
      const [single] = payload.containers;
      const singleVariables = {
        DD_CONTAINER_NAME: single.name,
        DD_IMAGE: single.image,
        DD_LOCAL_TAG: single.localTag,
        DD_BASE_IMAGE: single.baseImage,
        DD_CURRENT_BASE_TAG: single.currentBaseTag,
        DD_NEW_BASE_TAG: single.newBaseTag,
        DD_CURRENT_BASE_DIGEST: single.currentBaseDigest,
        DD_NEW_BASE_DIGEST: single.newBaseDigest,
      };
      for (const [key, value] of Object.entries(singleVariables)) {
        if (value !== undefined) {
          form.set(`variables[${key}]`, value);
        }
      }
    }
    const base = this.configuration.url.replace(/\/+$/, '');
    const project = encodeURIComponent(this.configuration.project);
    return sendRebuildRequest(
      {
        ...buildRebuildRequestOptions(this.configuration, label),
        url: `${base}/api/v4/projects/${project}/trigger/pipeline`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'drydock' },
        data: form.toString(),
      },
      label,
    );
  }
}

export default Gitlabpipeline;
