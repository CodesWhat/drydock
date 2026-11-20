import type { AxiosRequestConfig } from 'axios';
import { withAuthorizationHeader } from '../../../security/auth.js';
import {
  buildRebuildPayload,
  buildRebuildRequestOptions,
  maskProxyUrl,
  selectRebuildContainers,
  sendRebuildRequest,
} from '../ci-rebuild-shared.js';
import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface GithubdispatchConfiguration extends TriggerConfiguration {
  repository: string;
  token: string;
  eventtype: string;
  url: string;
  baseimageonly: boolean;
  proxy?: string;
  insecure: boolean;
}

/**
 * GitHub repository_dispatch trigger: asks a repository workflow to rebuild a
 * locally built image when its upstream base image has a newer tag.
 */
class Githubdispatch extends Trigger<GithubdispatchConfiguration> {
  getConfigurationSchema() {
    return this.joi.object().keys({
      repository: this.joi
        .string()
        .pattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
        .required(),
      token: this.joi.string().required(),
      eventtype: this.joi.string().default('drydock-base-image-update'),
      url: this.joi
        .string()
        .uri({ scheme: ['http', 'https'] })
        .default('https://api.github.com'),
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
    const label = `GitHub dispatch trigger ${this.getId()}`;
    const base = this.configuration.url.replace(/\/+$/, '');
    const options: AxiosRequestConfig = {
      ...buildRebuildRequestOptions(this.configuration, label),
      url: `${base}/repos/${this.configuration.repository}/dispatches`,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'drydock',
      },
      data: {
        event_type: this.configuration.eventtype,
        client_payload: buildRebuildPayload(selected),
      },
    };
    return sendRebuildRequest(
      withAuthorizationHeader(
        options,
        'Bearer',
        this.configuration.token,
        `Unable to authenticate ${label}: token is missing`,
      ) as AxiosRequestConfig,
      label,
    );
  }
}

export default Githubdispatch;
