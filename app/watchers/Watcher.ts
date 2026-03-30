import type { Container, ContainerReport } from '../model/container.js';
import Component from '../registry/Component.js';

/**
 * Watcher abstract class.
 */
abstract class Watcher extends Component {
  dockerApi?: unknown;
  lastRunAt?: string;

  protected constructor() {
    super();
  }

  getMetadata(): Record<string, unknown> {
    return {
      lastRunAt: this.lastRunAt,
    };
  }

  /**
   * Watch main method.
   * @returns {Promise<ContainerReport[]>}
   */
  abstract watch(): Promise<ContainerReport[]>;

  /**
   * Watch a Container.
   * @param container
   * @returns {Promise<ContainerReport>}
   */
  abstract watchContainer(container: Container): Promise<ContainerReport>;
}

export default Watcher;
