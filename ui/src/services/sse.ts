import {
  type BatchUpdateCompletedPayload,
  type ContainerLifecycleChangedPayload,
  type OperationChangedPayload,
  type ResyncRequiredPayload,
  type ScanLifecyclePayload,
  type SseBusEvent,
  type SseEventBus,
  type UpdateAppliedPayload,
  type UpdateFailedPayload,
  useEventStreamStore,
} from '@/stores/eventStream';

export type {
  BatchUpdateCompletedPayload,
  ContainerLifecycleChangedPayload,
  OperationChangedPayload,
  ResyncRequiredPayload,
  ScanLifecyclePayload,
  SseBusEvent,
  SseEventBus,
  UpdateAppliedPayload,
  UpdateFailedPayload,
};

class SseService {
  connect(eventBus: SseEventBus): void {
    useEventStreamStore().connect(eventBus);
  }

  disconnect(): void {
    useEventStreamStore().disconnect();
  }
}

export default new SseService();
