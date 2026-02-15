import { BasicStrategy as HttpBasicStrategy } from 'passport-http';

/**
 * Inherit from Basic Strategy including Session support.
 * @type {module.MyStrategy}
 */
class BasicStrategy extends HttpBasicStrategy {
  constructor(optionsOrVerify?: any, maybeVerify?: (...args: any[]) => void) {
    const verify =
      typeof optionsOrVerify === 'function'
        ? optionsOrVerify
        : typeof maybeVerify === 'function'
          ? maybeVerify
          : (_user: string, _pass: string, done: any) => done(null, false);
    super(verify);
  }

  authenticate(req) {
    // Already authenticated (thanks to session) => ok
    if (req.isAuthenticated()) {
      return (this as any).success(req.user);
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
