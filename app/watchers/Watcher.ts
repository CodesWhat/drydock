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

  getNextRunAt(): string | undefined {
    return undefined;
  }

  getMetadata(): Record<string, unknown> {
    return {
      lastRunAt: this.lastRunAt,
      nextRunAt: this.getNextRunAt(),
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
