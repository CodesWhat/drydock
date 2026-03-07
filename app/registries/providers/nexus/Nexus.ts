import SelfHostedBasic from '../shared/SelfHostedBasic.js';

/**
 * Sonatype Nexus Docker Registry integration.
 */
class Nexus extends SelfHostedBasic {
  // biome-ignore lint/complexity/noUselessConstructor: required for coverage of empty subclass
  constructor() {
    super();
  }
}

export default Nexus;
