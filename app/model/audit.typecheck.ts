import type { AuditEntry } from './audit.js';

const action: AuditEntry['action'] = 'container-update';
const policyAction: AuditEntry['action'] = 'update-policy-override-set';

void action;
void policyAction;
