/**
 * Request-scoped audit actor.
 *
 * The API layer binds the authenticated principal's name here once per request
 * (`app/api/audit-actor.ts`), and `insertAudit` reads it back, so every audit
 * row written while serving that request carries who asked for it without each
 * call site threading a username through. The value only ever comes from the
 * server-side principal, never from request input. Work that starts outside a
 * request (schedulers, auto-updates, agent events) runs with no actor and is
 * stored as NULL, which the API reports as `system`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const actorStorage = new AsyncLocalStorage<{ actor: string; role?: string }>();

/**
 * Run `fn` with `actor` attributed to every audit row it writes. `role` is the
 * role that actor held on this request, recorded beside it so the log keeps
 * what authority acted after a later role change. API keys and the system have
 * none.
 */
export function runWithAuditActor<T>(actor: string, fn: () => T, role?: string): T {
  return actorStorage.run(role === undefined ? { actor } : { actor, role }, fn);
}

/** The actor bound to the current async context, if any. */
export function getAuditActor(): string | undefined {
  return actorStorage.getStore()?.actor;
}

/** The role the bound actor held, if it had one. */
export function getAuditActorRole(): string | undefined {
  return actorStorage.getStore()?.role;
}

/**
 * Run `fn` outside any bound actor. Request handlers that (re)register
 * components use this so timers and schedulers armed during registration (cron
 * jobs, intervals) don't capture the admin's actor and attribute every later
 * scheduled run to them.
 */
export function runOutsideAuditActor<T>(fn: () => T): T {
  return actorStorage.exit(fn);
}
