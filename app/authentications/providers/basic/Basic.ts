import { createHash, timingSafeEqual } from 'node:crypto';
import passJs from 'pass';
import Authentication from '../Authentication.js';
import BasicStrategy from './BasicStrategy.js';

function hashValue(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Htpasswd authentication.
 */
class Basic extends Authentication {
  /**
   * Get the Trigger configuration schema.
   * @returns {*}
   */
  getConfigurationSchema() {
    return this.joi.object().keys({
      user: this.joi.string().required(),
      hash: this.joi.string().required(),
    });
  }

  /**
   * Sanitize sensitive data
   * @returns {*}
   */
  maskConfiguration() {
    return {
      user: this.configuration.user,
      hash: Basic.mask(this.configuration.hash),
    };
  }

  /**
   * Return passport strategy.
   */
  getStrategy(_app?: unknown) {
    return new BasicStrategy((user, pass, done) => this.authenticate(user, pass, done));
  }

  getStrategyDescription() {
    return {
      type: 'basic',
      name: 'Login',
    };
  }

  authenticate(
    user: unknown,
    pass: string,
    done: (error: unknown, user?: { username: string } | false) => void,
  ): void {
    const providedUser = typeof user === 'string' ? user : '';
    const userMatches =
      providedUser.length > 0 &&
      timingSafeEqual(hashValue(providedUser), hashValue(this.configuration.user));

    // No user or different user? => reject
    if (!userMatches) {
      done(null, false);
      return;
    }

    // Different password? => reject
    passJs.validate(pass, this.configuration.hash, (err, success) => {
      if (success) {
        done(null, {
          username: this.configuration.user,
        });
      } else {
        done(null, false);
      }
    });
  }
}

export default Basic;
