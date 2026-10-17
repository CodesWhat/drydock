import {
  agentRestrictionProblems,
  buildRoutingEntry,
  DEPENDS_ON_ACTIONS,
  declaredRoutingEntries,
  fieldKind,
  isEntryPermittedByDeclared,
  MAX_LIST_ENTRIES,
  normalizeRoutingEntry,
  permittedThresholds,
  ROUTING_THRESHOLDS,
  splitRoutingEntry,
  triggerCategoryOf,
  validateNameListDraft,
  validateRoutingDraft,
} from '@/composables/labelOverrideLists';

const known = {
  action: ['docker.local', 'dockercompose.stack'],
  notification: ['slack.team', 'smtp.mail'],
};

describe('field kinds', () => {
  it('maps every override field to an editor kind and trigger category', () => {
    expect(fieldKind('displayName')).toBe('text');
    expect(fieldKind('displayIcon')).toBe('icon');
    expect(fieldKind('dependsOn')).toBe('name-list');
    expect(fieldKind('dependsOnAction')).toBe('action');
    expect(fieldKind('notificationTriggerInclude')).toBe('trigger-list');
    expect(fieldKind('actionTriggerAuto')).toBe('trigger-list');
    expect(triggerCategoryOf('notificationTriggerExclude')).toBe('notification');
    expect(triggerCategoryOf('actionTriggerExclude')).toBe('action');
    expect(triggerCategoryOf('dependsOn')).toBeNull();
    expect(DEPENDS_ON_ACTIONS).toEqual(['update', 'restart']);
    expect(ROUTING_THRESHOLDS).toHaveLength(12);
    expect(MAX_LIST_ENTRIES).toBe(32);
  });
});

describe('routing entry grammar', () => {
  it('splits and builds reference:threshold entries', () => {
    expect(splitRoutingEntry('slack.team')).toEqual({ reference: 'slack.team', threshold: '' });
    expect(splitRoutingEntry('slack.team:Minor')).toEqual({
      reference: 'slack.team',
      threshold: 'Minor',
    });
    expect(buildRoutingEntry('slack.team', '')).toBe('slack.team');
    expect(buildRoutingEntry('slack.team', 'minor')).toBe('slack.team:minor');
  });

  it('normalizes the comparison form with the default threshold all', () => {
    expect(normalizeRoutingEntry('Slack.Team')).toBe('slack.team:all');
    expect(normalizeRoutingEntry('Slack.Team:MINOR')).toBe('slack.team:minor');
  });
});

describe('validateNameListDraft', () => {
  it('accepts valid unique names, including ones that are not running', () => {
    expect(validateNameListDraft(['db', 'cache-1', 'not.there'], ['web'])).toEqual([]);
    expect(validateNameListDraft([], ['web'])).toEqual([]);
  });

  it('flags bad names, duplicates, self references and too many entries', () => {
    expect(validateNameListDraft(['-bad', 'ok'], [])).toEqual([
      { code: 'invalid-name', entries: ['-bad'] },
    ]);
    expect(validateNameListDraft(['db', 'db'], [])).toEqual([
      { code: 'duplicate-entry', entries: ['db'] },
    ]);
    expect(validateNameListDraft(['web'], ['web', 'web-2'])).toEqual([
      { code: 'depends-on-self', entries: ['web'] },
    ]);
    const many = Array.from({ length: 33 }, (_, index) => `c${index}`);
    expect(validateNameListDraft(many, [])).toEqual([{ code: 'too-many-entries', entries: [] }]);
  });
});

describe('validateRoutingDraft', () => {
  it('accepts known references of the right kind with or without a threshold', () => {
    expect(
      validateRoutingDraft(['slack.team', 'smtp.mail:minor', 'team'], 'notification', known),
    ).toEqual([]);
    expect(validateRoutingDraft(['docker.local', 'local'], 'action', known)).toEqual([]);
    expect(validateRoutingDraft([], 'action', known)).toEqual([]);
  });

  it('flags a bad reference, an unsupported threshold, a duplicate and too many entries', () => {
    expect(validateRoutingDraft(['bad ref', 'a:b:c'], 'action', null)).toEqual([
      { code: 'invalid-reference', entries: ['bad ref', 'a:b:c'] },
    ]);
    expect(validateRoutingDraft(['slack:weekly'], 'notification', null)).toEqual([
      { code: 'invalid-threshold', entries: ['slack:weekly'] },
    ]);
    expect(
      validateRoutingDraft(['slack.team', 'SLACK.team:all', 'smtp'], 'notification', null),
    ).toEqual([{ code: 'duplicate-entry', entries: ['SLACK.team:all'] }]);
    const many = Array.from({ length: 33 }, (_, index) => `t${index}`);
    expect(validateRoutingDraft(many, 'action', null)).toEqual([
      { code: 'too-many-entries', entries: [] },
    ]);
  });

  it('rejects references no known trigger of that kind answers to', () => {
    expect(validateRoutingDraft(['ghost.one', 'docker.local'], 'action', known)).toEqual([
      { code: 'unknown-trigger-reference', entries: ['ghost.one'] },
    ]);
    expect(validateRoutingDraft(['slack.team'], 'action', known)).toEqual([
      { code: 'wrong-trigger-category', entries: ['slack.team'] },
    ]);
  });

  it('does not also call a malformed reference unknown', () => {
    expect(validateRoutingDraft(['bad ref'], 'action', known)).toEqual([
      { code: 'invalid-reference', entries: ['bad ref'] },
    ]);
  });

  it('skips the known-list check when the trigger list could not be loaded', () => {
    expect(validateRoutingDraft(['ghost.one'], 'action', null)).toEqual([]);
  });
});

describe('agent restrict-only helpers', () => {
  it('reads a declared value as a list', () => {
    expect(declaredRoutingEntries(['slack.a'])).toEqual(['slack.a']);
    expect(declaredRoutingEntries(null)).toEqual([]);
    expect(declaredRoutingEntries('x')).toEqual([]);
  });

  it('permits only entries the first overlapping declared reference allows', () => {
    const declared = ['slack.team', 'docker:minor'];
    expect(isEntryPermittedByDeclared('slack.team', declared)).toBe(true);
    expect(isEntryPermittedByDeclared('slack.team:patch', declared)).toBe(true);
    expect(isEntryPermittedByDeclared('docker:minor', declared)).toBe(true);
    expect(isEntryPermittedByDeclared('docker:all', declared)).toBe(false);
    expect(isEntryPermittedByDeclared('team', declared)).toBe(false);
    expect(isEntryPermittedByDeclared('other', declared)).toBe(false);
    expect(isEntryPermittedByDeclared('slack.team', [])).toBe(false);
  });

  it('lists the thresholds a reference may use', () => {
    expect(permittedThresholds('slack.team', ['slack.team'])).toEqual([...ROUTING_THRESHOLDS]);
    expect(permittedThresholds('docker', ['docker:minor'])).toEqual(['minor']);
    expect(permittedThresholds('other', ['docker:minor'])).toEqual([]);
  });

  it('flags widening for exclude, include and auto the way the server does', () => {
    expect(agentRestrictionProblems('actionTriggerExclude', ['a', 'b'], ['a'])).toEqual([]);
    expect(agentRestrictionProblems('actionTriggerExclude', ['b'], ['a'])).toEqual([
      { code: 'agent-enforced-widening', entries: ['a:all'] },
    ]);
    expect(agentRestrictionProblems('actionTriggerExclude', ['b', 'a'], ['a'])).toEqual([
      { code: 'agent-enforced-widening', entries: ['a:all'] },
    ]);
    expect(agentRestrictionProblems('actionTriggerInclude', [], ['a'])).toEqual([
      { code: 'agent-enforced-widening', entries: ['a:all'] },
    ]);
    expect(agentRestrictionProblems('actionTriggerInclude', [], [])).toEqual([]);
    expect(agentRestrictionProblems('actionTriggerInclude', ['a:minor'], ['a'])).toEqual([]);
    expect(agentRestrictionProblems('actionTriggerAuto', ['z'], ['a'])).toEqual([
      { code: 'agent-enforced-widening', entries: ['z:all'] },
    ]);
    expect(agentRestrictionProblems('notificationTriggerInclude', ['z'], [])).toEqual([]);
  });
});
