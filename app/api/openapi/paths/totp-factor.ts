import { errorResponse, jsonResponse } from '../common.js';

const securityNote =
  'Session-only: an API key at any scope, a Basic header, OIDC and anonymous access are all refused with 403. The session must belong to a local account.';
const transportNote =
  'HTTPS (or a genuinely local client), unless the operator has allowed plain HTTP with `DD_AUTH_TOTP_ALLOWHTTP=true`';
const mutationNote = `Needs same-origin CSRF validation, a JSON body, and ${transportNote}. The caller re-authenticates in the request itself with their password and, while a factor is active, exactly one current TOTP code or unused recovery code.`;
const noStoreHeader = {
  'Cache-Control': { description: 'Always `no-store`', schema: { type: 'string' } },
} as const;

const enrollmentIdPathParam = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Enrollment identifier returned when the enrollment was started',
  schema: { type: 'string', format: 'uuid' },
} as const;

const reauthBody = (description: string) => ({
  required: true,
  description,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/TotpReauthenticationRequest' },
    },
  },
});

const sharedFailures = {
  400: errorResponse('Invalid request body'),
  401: errorResponse('Authentication required'),
  403: errorResponse(
    'Not a local browser session, HTTPS required, CSRF validation failed, or reauthentication failed',
  ),
  415: errorResponse('Content-Type must be application/json'),
  423: errorResponse('Account or second factor temporarily locked after repeated failures'),
  429: errorResponse('Too many requests'),
  503: errorResponse('Two-factor management is unavailable (key ring or store)'),
} as const;

export const totpFactorPaths = {
  '/api/v1/auth/totp-factor': {
    get: {
      tags: ['Authentication'],
      summary: 'Get the current account’s two-factor status',
      operationId: 'getTotpFactor',
      description: `Reports whether a TOTP factor is active, when it was activated, how many unused recovery codes remain and any pending enrollment. Never returns a seed, code, digest or counter. ${securityNote} Reading changes nothing, so it is also answered over plain HTTP.`,
      responses: {
        200: {
          ...jsonResponse('Factor status', { $ref: '#/components/schemas/TotpFactorStatus' }),
          headers: noStoreHeader,
        },
        401: errorResponse('Authentication required'),
        403: errorResponse('Not a local browser session'),
        429: errorResponse('Too many requests'),
      },
    },
    delete: {
      tags: ['Authentication', 'Actions'],
      summary: 'Remove the two-factor factor',
      operationId: 'removeTotpFactor',
      description: `Deletes the factor and its recovery codes and moves the account to a new factor version, which ends every other session of the account and closes their open streams. The session that made the call continues at password assurance. ${securityNote} ${mutationNote}`,
      requestBody: reauthBody('Password plus exactly one current proof'),
      responses: {
        204: { description: 'Factor removed', headers: noStoreHeader },
        404: errorResponse('No factor is active'),
        409: errorResponse('The factor changed during the request'),
        ...sharedFailures,
      },
    },
  },
  '/api/v1/auth/totp-enrollments': {
    post: {
      tags: ['Authentication', 'Actions'],
      summary: 'Start a two-factor enrollment',
      operationId: 'startTotpEnrollment',
      description: `Generates a seed on the server, stores it encrypted under the key ring and returns it **once**, with the \`otpauth:\` URI an authenticator app needs. The enrollment expires after ten minutes. With a factor already active this starts a replacement and the old factor stays mandatory until the new one is confirmed. ${securityNote} ${mutationNote}`,
      requestBody: reauthBody('Password, plus one current proof when a factor is active'),
      responses: {
        201: {
          ...jsonResponse('Enrollment started; the only time the secret is shown', {
            $ref: '#/components/schemas/TotpEnrollmentReveal',
          }),
          headers: {
            ...noStoreHeader,
            Location: {
              description: 'Path of the enrollment, `/api/v1/auth/totp-enrollments/{id}`',
              schema: { type: 'string' },
            },
          },
        },
        409: errorResponse('An enrollment is already pending, or the factor changed'),
        ...sharedFailures,
      },
    },
  },
  '/api/v1/auth/totp-enrollments/{id}': {
    put: {
      tags: ['Authentication', 'Actions'],
      summary: 'Confirm a two-factor enrollment with a code',
      operationId: 'confirmTotpEnrollment',
      description: `Activates the factor atomically when the code from the authenticator app is right. The confirmation code is recorded as spent, so it cannot be replayed to log in. Activation moves the account to a new factor version, which ends every other session and closes their streams; the caller keeps a fresh session at factor assurance. The response carries the ten recovery codes **once**. ${securityNote} Needs same-origin CSRF validation, a JSON body, and ${transportNote}.`,
      parameters: [enrollmentIdPathParam],
      requestBody: {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/TotpEnrollmentConfirmation' },
          },
        },
      },
      responses: {
        201: {
          ...jsonResponse('Factor active; the only time the recovery codes are shown', {
            $ref: '#/components/schemas/TotpFactorActivated',
          }),
          headers: noStoreHeader,
        },
        404: errorResponse('Unknown enrollment, or one that belongs to another account'),
        409: errorResponse('The factor changed since the enrollment started'),
        410: errorResponse('The enrollment expired'),
        422: errorResponse('The code does not match'),
        ...sharedFailures,
      },
    },
    delete: {
      tags: ['Authentication', 'Actions'],
      summary: 'Cancel a pending two-factor enrollment',
      operationId: 'cancelTotpEnrollment',
      description: `Idempotent: an unknown, expired, already-cancelled or foreign enrollment answers the same 204. An active factor is untouched. ${securityNote} Needs same-origin CSRF validation and ${transportNote}.`,
      parameters: [enrollmentIdPathParam],
      responses: {
        204: { description: 'Nothing pending for this id any more', headers: noStoreHeader },
        401: errorResponse('Authentication required'),
        403: errorResponse(
          'Not a local browser session, HTTPS required, or CSRF validation failed',
        ),
        429: errorResponse('Too many requests'),
      },
    },
  },
  '/api/v1/auth/totp-recovery-code-sets': {
    post: {
      tags: ['Authentication', 'Actions'],
      summary: 'Replace the recovery codes',
      operationId: 'replaceTotpRecoveryCodes',
      description: `Replaces the whole set with ten new codes, shown **once**. Every old code stops working immediately. The factor version is unchanged, so no session is ended. ${securityNote} ${mutationNote}`,
      requestBody: reauthBody('Password plus exactly one current proof'),
      responses: {
        201: {
          ...jsonResponse('New recovery codes; the only time they are shown', {
            $ref: '#/components/schemas/TotpRecoveryCodeSet',
          }),
          headers: noStoreHeader,
        },
        404: errorResponse('No factor is active'),
        409: errorResponse('The recovery codes changed during the request'),
        ...sharedFailures,
      },
    },
  },
} as const;
