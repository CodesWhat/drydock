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
   * Return no HTTP auth challenge so browsers do not show the native basic-auth popup.
   * Passport still responds with 401 when authentication fails.
   * @returns {undefined}
   * @private
   */
  _challenge() {
    return undefined;
  }
}

export default BasicStrategy;
