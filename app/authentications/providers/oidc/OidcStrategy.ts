import { Strategy } from 'openid-client/passport';

class OidcStrategy extends Strategy {
  options: any;
  log: any;
  verify: any;

  /**
   * Constructor.
   * @param options
   * @param verify
   * @param log
   */
  constructor(options, verify, log) {
    super(options, verify);
    this.options = options;
    this.log = log;
    this.verify = verify;
  }

  /**
   * Authenticate method.
   * @param req
   */
  authenticate(req) {
    // Already authenticated (thanks to session) => ok
    this.log.debug('Executing oidc strategy');
    if (req.isAuthenticated()) {
      this.log.debug('User is already authenticated');
      (this as any).success(req.user);
    } else {
      // Get bearer token if so
      const authorization = req.headers.authorization || '';
      const authSplit = authorization.split('Bearer ');
      if (authSplit.length === 2) {
        this.log.debug('Bearer token found => validate it');
        const accessToken = authSplit[1];
        this.verify(accessToken, (err, user) => {
          if (err || !user) {
            this.log.warn('Bearer token is invalid');
            (this as any).fail(401);
          } else {
            this.log.debug('Bearer token is valid');
            (this as any).success(user);
          }
        });
        // Fail if no bearer token
      } else {
        this.log.debug('No bearer token found in the request');
        (this as any).fail(401);
      }
    }
  }
}

export default OidcStrategy;
