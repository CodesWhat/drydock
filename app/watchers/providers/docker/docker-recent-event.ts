export interface DockerRecentEvent {
  timestamp: string;
  action?: string;
  type?: string;
  id?: string;
  actorId?: string;
}

export function toEventTimestamp(rawDockerEvent: Record<string, unknown>): string {
  const rawTimeNano = rawDockerEvent.timeNano;
  if (typeof rawTimeNano === 'number' && Number.isFinite(rawTimeNano) && rawTimeNano > 0) {
    return new Date(Math.trunc(rawTimeNano / 1_000_000)).toISOString();
  }

  const rawTime = rawDockerEvent.time;
  if (typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime > 0) {
    const timestampMs =
      rawTime > 1_000_000_000_000 ? Math.trunc(rawTime) : Math.trunc(rawTime * 1000);
    return new Date(timestampMs).toISOString();
  }

  return new Date().toISOString();
}

/** Normalise a raw Docker event into a history entry; undefined for a non-object payload. */
export function toRecentDockerEvent(dockerEvent: unknown): DockerRecentEvent | undefined {
  if (!dockerEvent || typeof dockerEvent !== 'object') {
    return undefined;
  }

  const dockerEventRecord = dockerEvent as Record<string, unknown>;
  const actor = dockerEventRecord.Actor;
  const actorId =
    actor && typeof actor === 'object' && typeof (actor as Record<string, unknown>).ID === 'string'
      ? ((actor as Record<string, unknown>).ID as string)
      : undefined;

  return {
    timestamp: toEventTimestamp(dockerEventRecord),
    action:
      typeof dockerEventRecord.Action === 'string'
        ? dockerEventRecord.Action
        : typeof dockerEventRecord.status === 'string'
          ? dockerEventRecord.status
          : undefined,
    type:
      typeof dockerEventRecord.Type === 'string'
        ? dockerEventRecord.Type
        : typeof dockerEventRecord.scope === 'string'
          ? dockerEventRecord.scope
          : undefined,
    id: typeof dockerEventRecord.id === 'string' ? dockerEventRecord.id : undefined,
    actorId,
  };
}
