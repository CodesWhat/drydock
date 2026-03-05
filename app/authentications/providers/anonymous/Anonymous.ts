import { Strategy as AnonymousStrategy } from 'passport-anonymous';
import log from '../../../log/index.js';
import Authentication from '../Authentication.js';

/**
 * Anonymous authentication.
 */
class Anonymous extends Authentication {
  private ensureConfirmationEnabled(): void {
    if (process.env.DD_AUTH_ANONYMOUS_CONFIRM?.trim().toLowerCase() === 'true') {
      return;
    }

    throw new Error(
      'Anonymous authentication requires DD_AUTH_ANONYMOUS_CONFIRM=true. Set DD_AUTH_ANONYMOUS_CONFIRM=true only for trusted networks.',
    );
  }

  initAuthentication(): void {
    this.ensureConfirmationEnabled();
  }

  /**
   * Return passport strategy.
   */
  getStrategy() {
    this.ensureConfirmationEnabled();
    log.warn(
      'Anonymous authentication is enabled; please make sure that the app is not exposed to unsecure networks',
    );
    return new AnonymousStrategy();
  }

  getStrategyDescription() {
    return {
      type: 'anonymous',
      name: 'Anonymous',
    };
  }
}

export default Anonymous;
