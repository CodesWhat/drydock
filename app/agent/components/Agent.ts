import type joi from 'joi';
import Component from '../../registry/Component.js';

export type AgentAuthMode = 'token' | 'ed25519';

export interface AgentConfiguration {
  host: string;
  port: number;
  // Required when authmode is 'token' (the default); ignored for 'ed25519'.
  secret: string;
  cafile?: string;
  certfile?: string;
  keyfile?: string;
  // Selects how requests to this agent are authenticated. Defaults to 'token'
  // (the pre-existing X-Dd-Agent-Secret header behavior) so existing configs
  // are unaffected. 'ed25519' signs each request per Portwing's per-request
  // signature scheme (internal/auth/verify.go) instead.
  authmode?: AgentAuthMode;
  // Required when authmode is 'ed25519': the key identifier sent as
  // X-Portwing-Key-ID, matching the id Portwing derived when the
  // corresponding public key was registered (hex(SHA-256(pubkey)[:8])).
  signingkeyid?: string;
  // Required when authmode is 'ed25519': PEM-encoded PKCS#8 Ed25519 private
  // key material (the format produced by Portwing's `internal/auth/keygen.go`
  // / `cmd/keygen`). May be supplied via the generic DD_AGENT_<NAME>_SIGNINGKEY__FILE
  // env var convention (see app/configuration/index.ts replaceSecrets) to load
  // it from a file instead of inlining it.
  signingkey?: string;
}

export default class Agent extends Component<AgentConfiguration> {
  /**
   * Get the component configuration schema.
   * @returns {*}
   */
  getConfigurationSchema(): joi.ObjectSchema {
    return this.joi.object().keys({
      host: this.joi.string().required(),
      port: this.joi.number().port().default(3000),
      authmode: this.joi.string().valid('token', 'ed25519').default('token'),
      // secret is required in the default 'token' authmode (unchanged behavior);
      // optional (and irrelevant) under 'ed25519'.
      secret: this.joi.string().when('authmode', {
        is: 'ed25519',
        then: this.joi.string().allow('').optional(),
        otherwise: this.joi.string().required(),
      }),
      signingkeyid: this.joi.string().when('authmode', {
        is: 'ed25519',
        then: this.joi.string().required(),
        otherwise: this.joi.string().optional(),
      }),
      signingkey: this.joi.string().when('authmode', {
        is: 'ed25519',
        then: this.joi.string().required(),
        otherwise: this.joi.string().optional(),
      }),
      cafile: this.joi.string().optional(),
      certfile: this.joi.string().optional(),
      keyfile: this.joi.string().optional(),
    });
  }

  /**
   * Mask the configuration.
   * @param configuration
   * @returns {*}
   */
  maskConfiguration(configuration?: AgentConfiguration): AgentConfiguration {
    const config = configuration || this.configuration;
    const secret = typeof config.secret === 'string' ? config.secret : undefined;
    const signingkey = typeof config.signingkey === 'string' ? config.signingkey : undefined;
    return {
      ...config,
      secret: Component.mask(secret),
      ...(config.signingkey !== undefined ? { signingkey: Component.mask(signingkey) } : {}),
    };
  }
}
