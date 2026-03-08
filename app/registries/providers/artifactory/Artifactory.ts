import SelfHostedBasic from '../shared/SelfHostedBasic.js';

/**
 * JFrog Artifactory Docker Registry integration.
 */
class Artifactory extends SelfHostedBasic {
  // biome-ignore lint/complexity/noUselessConstructor: required for coverage of empty subclass
  constructor() {
    super();
  }
}

export default Artifactory;
