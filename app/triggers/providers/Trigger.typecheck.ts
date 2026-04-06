import { getNotificationEvent, type TriggerNotificationContainer } from './Trigger.js';

type NotificationEvent = NonNullable<ReturnType<typeof getNotificationEvent>>;
type ReconnectEvent = Extract<NotificationEvent, { kind: 'agent-reconnect' }>;
type DisconnectEvent = Extract<NotificationEvent, { kind: 'agent-disconnect' }>;

const reconnectEvent: ReconnectEvent = {
  kind: 'agent-reconnect',
  agentName: 'servicevault',
};

void reconnectEvent.agentName;
const _reconnectEventWithReason: ReconnectEvent = {
  kind: 'agent-reconnect',
  agentName: 'servicevault',
  // @ts-expect-error reconnect events should not accept disconnect reasons.
  reason: 'unexpected',
};

const disconnectEvent = getNotificationEvent({
  notificationEvent: {
    kind: 'agent-disconnect',
    agentName: 'servicevault',
    reason: 'SSE connection lost',
  },
} as any);

if (disconnectEvent && disconnectEvent.kind === 'agent-disconnect') {
  void disconnectEvent.reason;
}

const typedDisconnectEvent: DisconnectEvent = {
  kind: 'agent-disconnect',
  agentName: 'servicevault',
  reason: 'SSE connection lost',
};

void typedDisconnectEvent.reason;

type NotificationField = TriggerNotificationContainer['notificationEvent'];

const updateAppliedNotification: NotificationField = {
  kind: 'update-applied',
};

void updateAppliedNotification.kind;
