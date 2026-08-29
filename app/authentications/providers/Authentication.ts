import type { Strategy } from 'passport';
import type { Authenticator } from '../../api/authenticator-chain.js';
import Component, { type ComponentConfiguration } from '../../registry/Component.js';

export interface StrategyDescription {
  type: string;
  name: string;
  redirect?: string | boolean;
  logoutUrl?: string;
}

class Authentication<
  TConfiguration extends ComponentConfiguration = ComponentConfiguration,
> extends Component<TConfiguration> {
  /**
   * Init the Trigger.
   */
  async init(): Promise<void> {
    return this.initAuthentication();
  }

  /**
   * Init Trigger. Can be overridden in trigger implementation class.
   */
  initAuthentication(): void | Promise<void> {
    // do nothing by default
  }

  /**
   * Return passport strategy.
   */
  getStrategy(_app?: unknown): Strategy {
    throw new Error('getStrategy must be implemented');
  }

  /**
   * Return the authenticator this provider contributes to the chain.
   */
  getAuthenticator(_app?: unknown): Authenticator {
    throw new Error('getAuthenticator must be implemented');
  }

  getStrategyDescription(): StrategyDescription {
    throw new Error('getStrategyDescription must be implemented');
  }
}

export default Authentication;
