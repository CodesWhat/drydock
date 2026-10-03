import { validateSessionUser } from '../api/session-principal.js';
import { readSessionUsername } from '../api/session-user.js';

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
  /** The stored user, kept so validity can be re-checked against the store later. */
  rawUser?: unknown;
  sortTimestamp: number;
}

/**
 * `rawUser` is absent for the session a login has just recorded: it was minted
 * a moment ago, so it is taken as valid until the index is rebuilt.
 */
interface IndexedSession {
  sortTimestamp: number;
  rawUser?: unknown;
}

type UsernameSessionIndex = Map<string, Map<string, IndexedSession>>;

const sessionIndexByStore = new WeakMap<SessionStoreLike, UsernameSessionIndex>();
const loadingSessionIndexByStore = new WeakMap<SessionStoreLike, Promise<UsernameSessionIndex>>();

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

function extractSessionUser(sessionPayload: Record<string, unknown>): unknown {
  const passport = sessionPayload.passport;
  if (!passport || typeof passport !== 'object') {
    return undefined;
  }

  return (passport as Record<string, unknown>).user;
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

function toStoredSession(sid: string, rawSession: unknown): StoredSession | undefined {
  if (sid.length === 0) {
    return undefined;
  }

  const sessionPayload = extractSessionPayload(rawSession);
  if (!sessionPayload) {
    return undefined;
  }

  const rawUser = extractSessionUser(sessionPayload);
  return {
    sid,
    username: readSessionUsername(rawUser),
    rawUser,
    sortTimestamp: extractSortTimestamp(sessionPayload),
  };
}

function toStoredSessionFromArrayEntry(entry: unknown): StoredSession | undefined {
  if (!entry || typeof entry !== 'object') {
    return undefined;
  }

  const entryRecord = entry as Record<string, unknown>;
  const sid = typeof entryRecord.sid === 'string' ? entryRecord.sid : '';
  const rawSessionPayload = Object.hasOwn(entryRecord, 'session')
    ? entryRecord.session
    : entryRecord;
  return toStoredSession(sid, rawSessionPayload);
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function normalizeStoredSessions(rawSessions: unknown): StoredSession[] {
  if (!rawSessions || typeof rawSessions !== 'object') {
    return [];
  }

  if (Array.isArray(rawSessions)) {
    return rawSessions.map(toStoredSessionFromArrayEntry).filter(isDefined);
  }

  return Object.entries(rawSessions as Record<string, unknown>)
    .map(([sid, rawSession]) => toStoredSession(sid, rawSession))
    .filter(isDefined);
}

function listStoredSessions(sessionStore: SessionStoreLike): Promise<StoredSession[]> {
  return new Promise((resolve, reject) => {
    if (typeof sessionStore.all !== 'function') {
      resolve([]);
      return;
    }

    sessionStore.all((error, sessions) => {
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

function buildUsernameSessionIndex(sessions: StoredSession[]): UsernameSessionIndex {
  const sessionIndex: UsernameSessionIndex = new Map();
  for (const session of sessions) {
    if (!session.username || session.username.length === 0) {
      continue;
    }
    let userSessions = sessionIndex.get(session.username);
    if (!userSessions) {
      userSessions = new Map<string, IndexedSession>();
      sessionIndex.set(session.username, userSessions);
    }
    userSessions.set(session.sid, {
      sortTimestamp: session.sortTimestamp,
      rawUser: session.rawUser,
    });
  }
  return sessionIndex;
}

function getCachedUsernameSessionIndex(
  sessionStore: SessionStoreLike,
): UsernameSessionIndex | undefined {
  return sessionIndexByStore.get(sessionStore);
}

async function getOrCreateUsernameSessionIndex(
  sessionStore: SessionStoreLike,
): Promise<UsernameSessionIndex> {
  const cachedIndex = getCachedUsernameSessionIndex(sessionStore);
  if (cachedIndex) {
    return cachedIndex;
  }

  const loadingIndex = loadingSessionIndexByStore.get(sessionStore);
  if (loadingIndex) {
    return loadingIndex;
  }

  const loadingPromise = listStoredSessions(sessionStore)
    .then((sessions) => {
      const sessionIndex = buildUsernameSessionIndex(sessions);
      sessionIndexByStore.set(sessionStore, sessionIndex);
      return sessionIndex;
    })
    .finally(() => {
      loadingSessionIndexByStore.delete(sessionStore);
    });

  loadingSessionIndexByStore.set(sessionStore, loadingPromise);
  return loadingPromise;
}

function listIndexedSessionsForUser(
  sessionIndex: UsernameSessionIndex,
  username: string,
  currentSessionId?: string,
): StoredSession[] {
  const userSessions = sessionIndex.get(username);
  if (!userSessions) {
    return [];
  }

  return Array.from(userSessions.entries())
    .filter(([sid]) => !currentSessionId || sid !== currentSessionId)
    .map(([sid, indexed]) => ({
      sid,
      username,
      rawUser: indexed.rawUser,
      sortTimestamp: indexed.sortTimestamp,
    }))
    .sort((s1, s2) => {
      if (s1.sortTimestamp !== s2.sortTimestamp) {
        return s1.sortTimestamp - s2.sortTimestamp;
      }
      return s1.sid.localeCompare(s2.sid);
    });
}

type SessionStanding = 'valid' | 'stale' | 'unavailable';

function standingOf(session: StoredSession): SessionStanding {
  if (session.rawUser === undefined) {
    return 'valid';
  }
  const serialized =
    typeof session.rawUser === 'string' ? session.rawUser : JSON.stringify(session.rawUser);
  const validation = validateSessionUser(serialized);
  if (validation.status === 'valid') {
    return 'valid';
  }
  return validation.status === 'unavailable' ? 'unavailable' : 'stale';
}

function removeDestroyedSessionsFromIndex(
  sessionIndex: UsernameSessionIndex,
  username: string,
  sessionsToDestroy: StoredSession[],
): void {
  const userSessions = sessionIndex.get(username);
  if (!userSessions) {
    return;
  }

  sessionsToDestroy.forEach((session) => {
    userSessions.delete(session.sid);
  });

  if (userSessions.size === 0) {
    sessionIndex.delete(username);
  }
}

function recordCurrentSessionInIndex(
  sessionIndex: UsernameSessionIndex,
  username: string,
  currentSessionId?: string,
): void {
  if (!currentSessionId || currentSessionId.length === 0) {
    return;
  }

  let userSessions = sessionIndex.get(username);
  if (!userSessions) {
    userSessions = new Map<string, IndexedSession>();
    sessionIndex.set(username, userSessions);
  }

  userSessions.set(currentSessionId, { sortTimestamp: Date.now() });
}

export async function enforceConcurrentSessionLimit({
  username,
  maxConcurrentSessions,
  sessionStore,
  currentSessionId,
}: EnforceConcurrentSessionLimitOptions): Promise<number> {
  if (!sessionStore || typeof sessionStore.destroy !== 'function') {
    return 0;
  }

  if (
    typeof sessionStore.all !== 'function' &&
    getCachedUsernameSessionIndex(sessionStore) === undefined
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
  const sessionIndex = await getOrCreateUsernameSessionIndex(sessionStore);
  const existingUserSessions = listIndexedSessionsForUser(
    sessionIndex,
    normalizedUsername,
    currentSessionId,
  );

  // A session that is no longer valid must not hold a slot against a person
  // who can still log in, so those are destroyed first and never counted.
  // When the store cannot say which sessions are valid, nothing is destroyed:
  // counting unknowns would evict valid sessions in favour of ones that may be
  // stale, and destroying unknowns would kill sessions that may be fine.
  const standings = existingUserSessions.map((session) => ({
    session,
    standing: standingOf(session),
  }));
  if (standings.some(({ standing }) => standing === 'unavailable')) {
    recordCurrentSessionInIndex(sessionIndex, normalizedUsername, currentSessionId);
    return 0;
  }

  const staleSessions = standings
    .filter(({ standing }) => standing === 'stale')
    .map(({ session }) => session);
  const validSessions = standings
    .filter(({ standing }) => standing === 'valid')
    .map(({ session }) => session);

  const overflowCount = Math.max(0, validSessions.length + 1 - maxConcurrentSessions);
  const sessionsToDestroy = [...staleSessions, ...validSessions.slice(0, overflowCount)];
  if (sessionsToDestroy.length === 0) {
    recordCurrentSessionInIndex(sessionIndex, normalizedUsername, currentSessionId);
    return 0;
  }

  await Promise.all(
    sessionsToDestroy.map((session) => destroyStoredSession(sessionStore, session.sid)),
  );

  removeDestroyedSessionsFromIndex(sessionIndex, normalizedUsername, sessionsToDestroy);
  recordCurrentSessionInIndex(sessionIndex, normalizedUsername, currentSessionId);
  return sessionsToDestroy.length;
}
