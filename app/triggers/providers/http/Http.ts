import { lookup as dnsLookup } from 'node:dns/promises';
import axios, { type AxiosRequestConfig } from 'axios';
import { getOutboundHttpTimeoutMs } from '../../../configuration/runtime-defaults.js';
import {
  failClosedAuth,
  requireAuthString,
  withAuthorizationHeader,
} from '../../../security/auth.js';

import Trigger, { type BatchRuntimeContext, type TriggerConfiguration } from '../Trigger.js';

interface HttpRequestOptions extends Omit<AxiosRequestConfig, 'proxy'> {
  proxy?: {
    host: string;
    port: number;
  };
}

/**
 * Check whether an IP address falls in a cloud metadata / link-local range
 * that should be blocked by the SSRF guard.
 *
 * Blocked ranges (private-range traffic is allowed — drydock is self-hosted):
 *   - 169.254.0.0/16   (IPv4 link-local, includes 169.254.169.254 IMDSv1)
 *   - fe80::/10        (IPv6 link-local)
 *   - fd00:ec2::254    (AWS IMDSv2 IPv6 metadata endpoint)
 *
 * RFC-1918 ranges (10.x, 172.16–31.x, 192.168.x) are intentionally allowed.
 *
 * IPv4-mapped IPv6 normalization: addresses of the form `::ffff:<ipv4>` (dotted-
 * quad or hex-pair variants) and the obsolete IPv4-compatible form `::<ipv4>` are
 * unwrapped to their embedded IPv4 address and re-checked against the IPv4 rules.
 * This closes the bypass where `[::ffff:169.254.169.254]` would pass all guards
 * because the literal address contains `:` (treated as IPv6) yet matches none of
 * the IPv6 blocked ranges.
 */
export function isMetadataAddress(address: string): boolean {
  // IPv4 169.254.0.0/16
  const v4LinkLocal = /^169\.254\.\d{1,3}\.\d{1,3}$/;
  if (v4LinkLocal.test(address)) {
    return true;
  }

  // Normalize to lowercase for IPv6 checks
  const lower = address.toLowerCase();

  // --- IPv4-mapped / IPv4-compatible IPv6 normalization ---
  // Unwrap the embedded IPv4 address and recurse so the IPv4 rules apply.
  //
  // All patterns require at least one colon-delimited prefix group so that
  // bare IPv4 strings (e.g. "192.168.1.1") never accidentally match and
  // trigger infinite recursion.

  // Dotted-quad mapped form: ::ffff:169.254.169.254  (and uncompressed variants,
  // mixed case).  The prefix must contain at least one `<hex>:` segment before
  // the optional `ffff:` marker.  Also handles the obsolete compatible form
  // ::169.254.169.254 (all-zero prefix + embedded dotted-quad, no ffff marker).
  const dottedQuadMapped =
    /^(?:[0-9a-f]{0,4}:)+(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (dottedQuadMapped) {
    return isMetadataAddress(dottedQuadMapped[1]);
  }

  // Hex-pair mapped form: ::ffff:a9fe:a9fe  (last two hextets encode the IPv4).
  // Matches ::ffff:<h1>:<h2> and uncompressed equivalents like
  // 0:0:0:0:0:ffff:<h1>:<h2>.  The prefix must start with at least one
  // `<hex>:` segment before the `ffff:` marker.
  const hexMapped = /^(?:[0-9a-f]{0,4}:)+ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
  if (hexMapped) {
    const h1 = Number.parseInt(hexMapped[1], 16);
    const h2 = Number.parseInt(hexMapped[2], 16);
    const ipv4 = `${(h1 >> 8) & 0xff}.${h1 & 0xff}.${(h2 >> 8) & 0xff}.${h2 & 0xff}`;
    return isMetadataAddress(ipv4);
  }

  // AWS IMDSv2 IPv6 metadata address
  if (lower === 'fd00:ec2::254') {
    return true;
  }

  // IPv6 link-local fe80::/10
  // The top 10 bits of fe80:: are 1111 1110 10, covering fe80–febf
  if (/^fe[89ab][0-9a-f]:/i.test(lower) || lower.startsWith('fe80')) {
    return true;
  }

  return false;
}

/**
 * Resolve a hostname (or literal IP) and verify none of the addresses fall
 * in the metadata/link-local ranges. Throws if a metadata address is found.
 *
 * When allowmetadata is true, the check is skipped entirely.
 */
async function guardAgainstMetadataAddress(url: string, allowmetadata: boolean): Promise<void> {
  if (allowmetadata) {
    return;
  }

  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // Strip IPv6 brackets
  const host = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;

  // Check literal IP addresses directly without DNS
  const isLiteralIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) || host.includes(':');

  if (isLiteralIp) {
    if (isMetadataAddress(host)) {
      throw new Error(
        `HTTP trigger blocked: "${host}" is a metadata/link-local address. Set allowmetadata=true to override.`,
      );
    }
    return;
  }

  // DNS resolution
  const records = await dnsLookup(host, { all: true });
  for (const record of records) {
    if (isMetadataAddress(record.address)) {
      throw new Error(
        `HTTP trigger blocked: "${host}" resolves to metadata/link-local address "${record.address}". Set allowmetadata=true to override.`,
      );
    }
  }
}

const SUPPORTED_PROXY_PROTOCOLS = new Set(['http:', 'https:']);

interface HttpConfiguration extends TriggerConfiguration {
  url: string;
  method: 'GET' | 'POST';
  auth?: {
    type?: 'BASIC' | 'BEARER';
    user?: string;
    password?: string;
    bearer?: string;
  };
  proxy?: string;
  allowmetadata: boolean;
}

/**
 * HTTP Trigger implementation
 */
class Http extends Trigger<HttpConfiguration> {
  private parseProxyConfiguration(proxy: string): NonNullable<HttpRequestOptions['proxy']> {
    const proxyUrl = new URL(proxy);
    if (!SUPPORTED_PROXY_PROTOCOLS.has(proxyUrl.protocol)) {
      throw new Error(
        `Unable to configure HTTP trigger ${this.getId()}: proxy URL scheme "${proxyUrl.protocol}" is unsupported`,
      );
    }

    const defaultProxyPort = proxyUrl.protocol === 'https:' ? 443 : 80;
    const proxyPort = proxyUrl.port ? Number.parseInt(proxyUrl.port, 10) : defaultProxyPort;
    return {
      host: proxyUrl.hostname,
      port: proxyPort,
    };
  }

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
        .required(),
      method: this.joi.string().valid('GET', 'POST').default('POST'),
      auth: this.joi
        .object({
          type: this.joi.string().uppercase().valid('BASIC', 'BEARER').default('BASIC'),
          user: this.joi.string(),
          password: this.joi.string(),
          bearer: this.joi.string(),
        })
        .custom((auth, helpers) => {
          const authType = auth.type as 'BASIC' | 'BEARER';
          if (authType === 'BASIC') {
            if (!auth.user) {
              return helpers.error('auth.basic.userMissing');
            }
            if (!auth.password) {
              return helpers.error('auth.basic.passwordMissing');
            }
          } else if (!auth.bearer) {
            return helpers.error('auth.bearer.missing');
          }

          return auth;
        }, 'HTTP auth validation')
        .messages({
          'auth.basic.userMissing': '"auth.user" is required',
          'auth.basic.passwordMissing': '"auth.password" is required',
          'auth.bearer.missing': '"auth.bearer" is required',
        }),
      proxy: this.joi.string().uri({
        scheme: ['http', 'https'],
      }),
      allowmetadata: this.joi.boolean().default(false),
    });
  }

  /**
   * Send an HTTP Request with new image version details.
   *
   * @param container the container
   * @returns {Promise<void>}
   */
  async trigger(container) {
    return this.sendHttpRequest(container);
  }

  /**
   * Send an HTTP Request with new image versions details.
   * @param containers
   * @returns {Promise<*>}
   */
  async triggerBatch(containers, runtimeContext?: BatchRuntimeContext) {
    // Security-digest (and any other prerendered-batch) callers supply a
    // title/body in runtimeContext; forward them as a structured envelope so
    // the webhook receiver gets the right text instead of a raw dump of stub
    // rows (#328). Update-digest callers continue to receive the raw
    // container array for backwards compatibility.
    if (runtimeContext?.title || runtimeContext?.body) {
      return this.sendHttpRequest({
        title: runtimeContext.title ?? '',
        body: runtimeContext.body ?? '',
        eventKind: runtimeContext.eventKind,
        containers,
      });
    }
    return this.sendHttpRequest(containers);
  }

  async sendHttpRequest(body) {
    await guardAgainstMetadataAddress(
      this.configuration.url,
      this.configuration.allowmetadata ?? false,
    );

    let options: HttpRequestOptions = {
      method: this.configuration.method,
      url: this.configuration.url,
      timeout: getOutboundHttpTimeoutMs(),
    };
    if (this.configuration.method === 'POST') {
      options.data = body;
    } else if (this.configuration.method === 'GET') {
      options.params = body;
    }
    if (this.configuration.auth) {
      const authType = `${this.configuration.auth.type || 'BASIC'}`.toUpperCase();
      if (authType === 'BASIC') {
        options.auth = {
          username: requireAuthString(
            this.configuration.auth.user,
            `Unable to authenticate HTTP trigger ${this.getId()}: basic auth username is missing`,
          ),
          password: requireAuthString(
            this.configuration.auth.password,
            `Unable to authenticate HTTP trigger ${this.getId()}: basic auth password is missing`,
          ),
        };
      } else if (authType === 'BEARER') {
        options = withAuthorizationHeader(
          options,
          'Bearer',
          this.configuration.auth.bearer,
          `Unable to authenticate HTTP trigger ${this.getId()}: bearer token is missing`,
        );
      } else {
        failClosedAuth(
          `Unable to authenticate HTTP trigger ${this.getId()}: auth type "${authType}" is unsupported`,
        );
      }
    }
    if (this.configuration.proxy) {
      options.proxy = this.parseProxyConfiguration(this.configuration.proxy);
    }
    const response = await axios(options);
    return response.data;
  }
}

export default Http;
