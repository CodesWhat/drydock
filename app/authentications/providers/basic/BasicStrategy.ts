import { BasicStrategy as HttpBasicStrategy } from 'passport-http';
import { asPassportStrategy } from '../PassportStrategy.js';

type VerifyCallback = (
  user: string,
  password: string,
  done: (error: unknown, user?: unknown) => void,
) => void;

/**
 * Inherit from Basic Strategy including Session support.
 * @type {module.MyStrategy}
 */
class BasicStrategy extends HttpBasicStrategy {
  constructor(optionsOrVerify?: unknown, verify?: VerifyCallback) {
    if (typeof optionsOrVerify === 'function') {
      super(optionsOrVerify);
      return;
    }

    if (typeof verify === 'function') {
      super(optionsOrVerify ?? {}, verify);
      return;
    }

    const fallbackVerify: VerifyCallback = (
      _: string,
      __: string,
      done: (error: unknown, user?: unknown) => void,
    ) => {
      done(null, false);
    };
    super(fallbackVerify);
  }

  authenticate(req) {
    // Already authenticated (thanks to session) => ok
    if (req.isAuthenticated()) {
      asPassportStrategy(this).success(req.user);
      return;
    }
    return super.authenticate(req);
  }

  /**
   * Override challenge to avoid browser popup on 401 errrors.
   * @returns {string}
   * @private
   */
  _challenge() {
    return 401;
  }
}

export default BasicStrategy;
