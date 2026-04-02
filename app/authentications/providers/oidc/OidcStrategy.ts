import type { Request } from 'express';
import passport from 'passport';
import { asPassportStrategy } from '../PassportStrategy.js';

type OidcStrategyOptions = {
  config?: unknown;
  scope?: string;
  name: string;
};

interface LoggerLike {
  debug: (message: string) => void;
  warn: (message: string) => void;
}

type VerifyDone = (error: unknown, user?: unknown | false) => void;
type VerifyHandler = (accessToken: string, done: VerifyDone) => void;

type VerifyFunction = (tokens: { access_token?: unknown }, done: VerifyDone) => void;

class OidcStrategy extends passport.Strategy {
  declare success: (user?: unknown) => void;
  declare fail: (status: number) => void;
  name: string;
  options: OidcStrategyOptions;
  log: LoggerLike;
  verify: VerifyHandler;
  _verify: VerifyFunction;

  /**
   * Constructor.
   * @param options
   * @param verify
   * @param log
   */
  constructor(options: OidcStrategyOptions, verify: VerifyHandler, log: LoggerLike) {
    super();
    const strategyVerify: VerifyFunction = (tokens, done) => {
      const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : '';
      verify(accessToken, done);
    };
    this.name = options.name;
    this.options = options;
    this.log = log;
    this.verify = verify;
    this._verify = strategyVerify;
  }

  /**
   * Authenticate method.
   * @param req
   */
  authenticate(req: Request & { isAuthenticated: () => boolean; user?: unknown }) {
    // Already authenticated (thanks to session) => ok
    const passportStrategy = asPassportStrategy(this);
    this.log.debug('Executing oidc strategy');
    if (req.isAuthenticated()) {
      this.log.debug('User is already authenticated');
      passportStrategy.success(req.user);
    } else {
      // Get bearer token if so
      const authorization = Array.isArray(req.headers.authorization)
        ? req.headers.authorization[0] || ''
        : (req.headers.authorization ?? '');
      const bearerTokenMatch = authorization.match(/^Bearer\s+(\S+)$/);
      const accessToken = bearerTokenMatch?.[1] ?? '';
      if (accessToken === '') {
        this.log.debug('No bearer token provided');
        passportStrategy.fail(401);
        return;
      }
      this.verify(accessToken, (err, user) => {
        if (err || !user) {
          this.log.warn('Bearer token validation failed');
          passportStrategy.fail(401);
        } else {
          this.log.debug('Bearer token validated');
          passportStrategy.success(user);
        }
      });
    }
  }
}

export default OidcStrategy;
