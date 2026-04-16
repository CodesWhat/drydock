import SelfHostedBasic, { type SelfHostedBasicConfiguration } from '../shared/SelfHostedBasic.js';

/**
 * Gitea Container Registry integration.
 */
class Gitea<
  TConfiguration extends SelfHostedBasicConfiguration = SelfHostedBasicConfiguration,
> extends SelfHostedBasic<TConfiguration> {}

export default Gitea;
