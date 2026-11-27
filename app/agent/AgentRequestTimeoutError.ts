/**
 * Portwing's stable code for a Docker round trip that exceeded the agent's
 * deadline (default, auto-deadline or the controller's per-request hint).
 * Carried on the edge `error` frame and, on a standard agent, as the
 * `X-Portwing-Code` header of a 504.
 */
export const AGENT_REQUEST_TIMEOUT_CODE = 'request_timeout';

const AGENT_REQUEST_TIMEOUT_MESSAGE =
  'The agent timed out waiting for Docker. The operation may still have completed; check the container state before retrying.';

export class AgentRequestTimeoutError extends Error {
  readonly code = AGENT_REQUEST_TIMEOUT_CODE;

  constructor(message?: string) {
    super(message ? `${message}. ${AGENT_REQUEST_TIMEOUT_MESSAGE}` : AGENT_REQUEST_TIMEOUT_MESSAGE);
    this.name = 'AgentRequestTimeoutError';
  }
}
