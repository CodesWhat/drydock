import * as audit from './audit.js';

test('audit counter should be properly configured', async () => {
  audit.init();
  var counter = audit.getAuditCounter();
  expect(counter.name).toStrictEqual('dd_audit_entries_total');
  expect(counter.labelNames).toStrictEqual(['action']);
});

test('audit init should replace existing counter when called twice', async () => {
  audit.init();
  var first = audit.getAuditCounter();
  audit.init();
  var second = audit.getAuditCounter();
  expect(second.name).toStrictEqual('dd_audit_entries_total');
  expect(second).not.toBe(first);
});

test('getAuditCounter should return undefined before init', async () => {
  vi.resetModules();
  var fresh = await import('./audit.js');
  expect(fresh.getAuditCounter()).toBeUndefined();
});
