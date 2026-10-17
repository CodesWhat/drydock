import type { AuditEntry } from './audit.js';

const action: AuditEntry['action'] = 'container-update';
const policyAction: AuditEntry['action'] = 'update-policy-override-set';
const groupPolicySetAction: AuditEntry['action'] = 'group-policy-set';
const groupPolicyClearedAction: AuditEntry['action'] = 'group-policy-cleared';

void action;
void policyAction;
void groupPolicySetAction;
void groupPolicyClearedAction;
