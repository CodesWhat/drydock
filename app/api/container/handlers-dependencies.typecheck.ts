import { createCrudHandlers } from './crud.js';
import { createLogHandlers } from './logs.js';
import { createSecurityHandlers } from './security.js';
import { createTriggerHandlers } from './triggers.js';
import { createUpdatePolicyHandlers } from './update-policy.js';

const crudDeps = {} as Parameters<typeof createCrudHandlers>[0];
const logDeps = {} as Parameters<typeof createLogHandlers>[0];
const securityDeps = {} as Parameters<typeof createSecurityHandlers>[0];
const triggerDeps = {} as Parameters<typeof createTriggerHandlers>[0];
const updatePolicyDeps = {} as Parameters<typeof createUpdatePolicyHandlers>[0];

createCrudHandlers({
  ...crudDeps,
  errorApi: {
    ...crudDeps.errorApi,
    // @ts-expect-error errorApi.getErrorMessage must be a function
    getErrorMessage: 123,
  },
});

// @ts-expect-error getErrorMessage must be a function
createLogHandlers({ ...logDeps, getErrorMessage: 123 });

// @ts-expect-error getErrorMessage must be a function
createSecurityHandlers({ ...securityDeps, getErrorMessage: 123 });

// @ts-expect-error sanitizeLogParam must be a function
createTriggerHandlers({ ...triggerDeps, sanitizeLogParam: 123 });

// @ts-expect-error uniqStrings must be a function
createUpdatePolicyHandlers({ ...updatePolicyDeps, uniqStrings: 123 });
