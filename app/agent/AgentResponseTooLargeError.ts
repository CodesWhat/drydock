/**
 * Portwing's stable code for a buffered (non-stream) response that exceeded its
 * 16 MiB cap. Carried on the edge `error` frame and on a legacy
 * `dd:container_log_response`.
 */
export const AGENT_RESPONSE_TOO_LARGE_CODE = 'response_too_large';

export const AGENT_RESPONSE_TOO_LARGE_MESSAGE =
  'Agent response exceeds the 16 MiB limit for a buffered request; use a streaming request';

export class AgentResponseTooLargeError extends Error {
  readonly code = AGENT_RESPONSE_TOO_LARGE_CODE;

  constructor(message?: string) {
    super(message || AGENT_RESPONSE_TOO_LARGE_MESSAGE);
    this.name = 'AgentResponseTooLargeError';
  }
}
