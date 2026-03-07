import Gitea from '../gitea/Gitea.js';

/**
 * Forgejo Container Registry integration.
 */
class Forgejo extends Gitea {
  // biome-ignore lint/complexity/noUselessConstructor: required for coverage of empty subclass
  constructor() {
    super();
  }
}

export default Forgejo;
