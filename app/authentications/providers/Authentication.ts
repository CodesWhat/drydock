import type { Strategy } from 'passport';
import Component from '../../registry/Component.js';

export interface StrategyDescription {
  type: string;
  name: string;
  redirect?: boolean;
  logoutUrl?: string;
  [key: string]: any;
}

class Authentication extends Component {
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
  getStrategy(_app?: any): Strategy {
    throw new Error('getStrategy must be implemented');
  }

  getStrategyDescription(): StrategyDescription {
    throw new Error('getStrategyDescription must be implemented');
  }
}

export default Authentication;
