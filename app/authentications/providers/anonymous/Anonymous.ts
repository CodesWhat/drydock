import { Strategy as AnonymousStrategy } from 'passport-anonymous';
import log from '../../../log/index.js';
import { isUpgrade } from '../../../store/app.js';
import Authentication from '../Authentication.js';

/**
 * Anonymous authentication.
 */
class Anonymous extends Authentication {
  private isExplicitlyConfirmed(): boolean {
    const canonical = process.env.DD_ANONYMOUS_AUTH_CONFIRM?.trim().toLowerCase();
    const alias = process.env.DD_AUTH_ANONYMOUS_CONFIRM?.trim().toLowerCase();
    return canonical === 'true' || alias === 'true';
  }

  initAuthentication(): void {
    if (this.isExplicitlyConfirmed()) {
      return;
    }
    if (isUpgrade()) {
      log.warn(
        'No authentication configured — the dashboard is accessible without login. Set DD_AUTH_BASIC_<name>_USER / DD_AUTH_BASIC_<name>_HASH to secure it, or set DD_ANONYMOUS_AUTH_CONFIRM=true to silence this warning.',
      );
      return;
    }
    throw new Error(
      'No authentication configured and this is a fresh install. Set DD_AUTH_BASIC_<name>_USER / DD_AUTH_BASIC_<name>_HASH to secure the dashboard, or set DD_ANONYMOUS_AUTH_CONFIRM=true to allow anonymous access.',
    );
  }

  /**
   * Return passport strategy.
   */
  getStrategy() {
    if (this.isExplicitlyConfirmed()) {
      return new AnonymousStrategy();
    }
    if (isUpgrade()) {
      log.warn(
        'Anonymous authentication is enabled without explicit confirmation; consider configuring authentication',
      );
      return new AnonymousStrategy();
    }
    throw new Error(
      'Anonymous authentication cannot be enabled on a fresh install without DD_ANONYMOUS_AUTH_CONFIRM=true',
    );
  }

  getStrategyDescription() {
    return {
      type: 'anonymous',
      name: 'Anonymous',
    };
  }
}

export default Anonymous;
