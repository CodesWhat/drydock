import {
  type OperationChangedPayload,
  type SseEventBus,
  useEventStreamStore,
} from '@/stores/eventStream';

export type { OperationChangedPayload };

class SseService {
  connect(eventBus: SseEventBus): void {
    useEventStreamStore().connect(eventBus);
  }

  disconnect(): void {
    useEventStreamStore().disconnect();
  }
}

export default new SseService();
