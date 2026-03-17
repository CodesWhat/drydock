import type { Request } from 'express';
import { Strategy, type StrategyOptions, type VerifyFunction } from 'openid-client/passport';
import { asPassportStrategy } from '../PassportStrategy.js';

type OidcStrategyOptions = StrategyOptions & {
  scope: string;
  name: string;
};

interface LoggerLike {
  debug: (message: string) => void;
  warn: (message: string) => void;
}

type VerifyDone = Parameters<VerifyFunction>[1];
type VerifyHandler = (accessToken: string, done: VerifyDone) => void;

class OidcStrategy extends Strategy {
  options: OidcStrategyOptions;
  log: LoggerLike;
  verify: VerifyHandler;

  /**
   * Constructor.
   * @param options
   * @param verify
   * @param log
   */
  constructor(options: OidcStrategyOptions, verify: VerifyHandler, log: LoggerLike) {
    const strategyVerify: VerifyFunction = (tokens, done) => {
      const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : '';
      verify(accessToken, done);
    };
    super(options, strategyVerify);
    this.options = options;
    this.log = log;
    this.verify = verify;
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
