interface SessionStoreLike {
  all?: (callback: (error: unknown, sessions?: unknown) => void) => void;
  destroy?: (sid: string, callback: (error?: unknown) => void) => void;
}

interface EnforceConcurrentSessionLimitOptions {
  username: string;
  maxConcurrentSessions: number;
  sessionStore?: SessionStoreLike;
  currentSessionId?: string;
}

interface StoredSession {
  sid: string;
  username?: string;
  sortTimestamp: number;
}

function parseTimestamp(value: unknown): number {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function extractSessionPayload(rawSession: unknown): Record<string, unknown> | undefined {
  if (typeof rawSession === 'string') {
    try {
      const parsed = JSON.parse(rawSession);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }

  if (!rawSession || typeof rawSession !== 'object') {
    return undefined;
  }

  const sessionRecord = rawSession as Record<string, unknown>;
  if (sessionRecord.session && typeof sessionRecord.session === 'object') {
    return sessionRecord.session as Record<string, unknown>;
  }
  return sessionRecord;
}

function extractSessionUsername(sessionPayload: Record<string, unknown>): string | undefined {
  const passport = sessionPayload.passport;
  if (!passport || typeof passport !== 'object') {
    return undefined;
  }

  const user = (passport as Record<string, unknown>).user;
  if (user && typeof user === 'object') {
    const username = (user as Record<string, unknown>).username;
    return typeof username === 'string' && username.length > 0 ? username : undefined;
  }

  if (typeof user !== 'string') {
    return undefined;
  }

  try {
    const parsed = JSON.parse(user);
    if (!parsed || typeof parsed !== 'object') {
      return undefined;
    }
    const username = (parsed as Record<string, unknown>).username;
    return typeof username === 'string' && username.length > 0 ? username : undefined;
  } catch {
    return undefined;
  }
}

function extractSortTimestamp(sessionPayload: Record<string, unknown>): number {
  const cookie = sessionPayload.cookie;
  if (!cookie || typeof cookie !== 'object') {
    return 0;
  }

  const cookieRecord = cookie as Record<string, unknown>;
  return (
    parseTimestamp(cookieRecord.expires) ||
    parseTimestamp(cookieRecord._expires) ||
    parseTimestamp(cookieRecord.originalMaxAge) ||
    0
  );
}

function normalizeStoredSessions(rawSessions: unknown): StoredSession[] {
  if (!rawSessions || typeof rawSessions !== 'object') {
    return [];
  }

  const sessions: StoredSession[] = [];

  if (Array.isArray(rawSessions)) {
    rawSessions.forEach((entry) => {
      if (!entry || typeof entry !== 'object') {
        return;
      }
      const entryRecord = entry as Record<string, unknown>;
      const sid = typeof entryRecord.sid === 'string' ? entryRecord.sid : '';
      if (sid.length === 0) {
        return;
      }
      const rawSessionPayload = Object.hasOwn(entryRecord, 'session')
        ? entryRecord.session
        : entryRecord;
      const sessionPayload = extractSessionPayload(rawSessionPayload);
      if (!sessionPayload) {
        return;
      }
      sessions.push({
        sid,
        username: extractSessionUsername(sessionPayload),
        sortTimestamp: extractSortTimestamp(sessionPayload),
      });
    });
    return sessions;
  }

  Object.entries(rawSessions as Record<string, unknown>).forEach(([sid, rawSession]) => {
    if (sid.length === 0) {
      return;
    }
    const sessionPayload = extractSessionPayload(rawSession);
    if (!sessionPayload) {
      return;
    }
    sessions.push({
      sid,
      username: extractSessionUsername(sessionPayload),
      sortTimestamp: extractSortTimestamp(sessionPayload),
    });
  });

  return sessions;
}

function listStoredSessions(sessionStore: SessionStoreLike): Promise<StoredSession[]> {
  return new Promise((resolve, reject) => {
    sessionStore.all?.((error, sessions) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(normalizeStoredSessions(sessions));
    });
  });
}

function destroyStoredSession(sessionStore: SessionStoreLike, sid: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sessionStore.destroy?.(sid, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function enforceConcurrentSessionLimit({
  username,
  maxConcurrentSessions,
  sessionStore,
  currentSessionId,
}: EnforceConcurrentSessionLimitOptions): Promise<number> {
  if (
    !sessionStore ||
    typeof sessionStore.all !== 'function' ||
    typeof sessionStore.destroy !== 'function'
  ) {
    return 0;
  }

  if (typeof username !== 'string' || username.trim().length === 0) {
    return 0;
  }

  if (!Number.isInteger(maxConcurrentSessions) || maxConcurrentSessions < 1) {
    return 0;
  }

  const normalizedUsername = username.trim();
  const existingUserSessions = (await listStoredSessions(sessionStore))
    .filter(
      (session) =>
        session.username === normalizedUsername &&
        (!currentSessionId || session.sid !== currentSessionId),
    )
    .sort((s1, s2) => {
      if (s1.sortTimestamp !== s2.sortTimestamp) {
        return s1.sortTimestamp - s2.sortTimestamp;
      }
      return s1.sid.localeCompare(s2.sid);
    });

  const overflowCount = existingUserSessions.length + 1 - maxConcurrentSessions;
  if (overflowCount <= 0) {
    return 0;
  }

  const sessionsToDestroy = existingUserSessions.slice(0, overflowCount);
  for (const session of sessionsToDestroy) {
    await destroyStoredSession(sessionStore, session.sid);
  }
  return sessionsToDestroy.length;
}
