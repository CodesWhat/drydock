import Gitea from '../gitea/Gitea.js';
import type { SelfHostedBasicConfiguration } from '../shared/SelfHostedBasic.js';

/**
 * Forgejo Container Registry integration.
 */
class Forgejo<
  TConfiguration extends SelfHostedBasicConfiguration = SelfHostedBasicConfiguration,
> extends Gitea<TConfiguration> {}

export default Forgejo;
