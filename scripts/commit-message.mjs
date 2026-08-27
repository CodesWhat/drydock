const COMMIT_TYPES = {
  feat: { purpose: 'new feature' },
  fix: { purpose: 'bug fix' },
  docs: { purpose: 'documentation change' },
  style: { purpose: 'style/cosmetic change' },
  refactor: { purpose: 'refactor without behavior change' },
  perf: { purpose: 'performance improvement' },
  test: { purpose: 'test change' },
  build: { purpose: 'build system or dependency change' },
  ci: { purpose: 'CI/CD configuration change' },
  chore: { purpose: 'tooling/misc change' },
  revert: { purpose: 'intentional revert' },
};

const typeAlternation = Object.keys(COMMIT_TYPES).join('|');

// Exactly one literal space after the colon, and the description must start
// with a non-space character — otherwise `feat:  Add x` slips a leading space
// into the description and dodges the lowercase-start check.
const subjectRegex = new RegExp(
  `^(?<type>${typeAlternation})(?:\\((?<scope>[a-z0-9][a-z0-9._/-]*)\\))?(?<breaking>!)?: (?<description>\\S.*)$`,
  'u',
);

// Fixup/squash autosquash commits are meant to be folded away by `git rebase
// --autosquash` before they ever reach history, so they're exempt from
// format checks the same way merge/revert commits are.
const autosquashRegex = /^(fixup|squash)!\s/u;

export function validateCommitMessage(rawMessage) {
  const message = (rawMessage ?? '').trim();
  const subject = message.split(/\r?\n/u, 1)[0] ?? '';

  // Allow default Git-generated metadata commits.
  if (subject.startsWith('Merge ')) {
    return { valid: true, errors: [] };
  }
  if (subject.startsWith('Revert "')) {
    return { valid: true, errors: [] };
  }
  if (autosquashRegex.test(subject)) {
    return { valid: true, errors: [] };
  }

  const errors = [];
  const match = subject.match(subjectRegex);

  if (/^\p{Emoji}/u.test(subject)) {
    errors.push('No emoji prefix — this repo uses plain Conventional Commits, not gitmoji.');
  }

  if (!match?.groups) {
    const strictPrefix = `^(?:${typeAlternation})(?:\\([a-z0-9][a-z0-9._/-]*\\))?!?:`;
    if (!new RegExp(`^(${typeAlternation})(\\(|!|:)`, 'u').test(subject)) {
      errors.push('Missing or unsupported commit type.');
    } else if (
      new RegExp(`${strictPrefix}\\s`, 'u').test(subject) &&
      !new RegExp(`${strictPrefix} \\S`, 'u').test(subject)
    ) {
      errors.push('Exactly one space after the colon.');
    }
    errors.push('Subject does not match required format.');

    return { valid: false, errors };
  }

  const { description } = match.groups;

  if (/^[A-Z]/u.test(description)) {
    errors.push('Description must be imperative and lowercase at the start.');
  }

  if (/\.$/u.test(description)) {
    errors.push('Description must not end with a trailing period.');
  }

  if (subject.length > 100) {
    errors.push('Subject exceeds 100 characters.');
  }

  return { valid: errors.length === 0, errors };
}

export function formatValidationFailure(rawMessage, errors) {
  const message = (rawMessage ?? '').trim();
  const subject = message.split(/\r?\n/u, 1)[0] ?? '';

  const allowedTypes = Object.entries(COMMIT_TYPES)
    .map(([type, meta]) => `  ${type}: ${meta.purpose}`)
    .join('\n');

  const formattedErrors = errors.map((error) => `  - ${error}`).join('\n');

  return [
    'Invalid commit message.',
    '',
    `Current subject: ${subject || '<empty>'}`,
    '',
    'Required subject format:',
    '  <type>(<scope>): <description>',
    '',
    'Use "!" before the colon for a breaking change, e.g. feat(api)!: drop v1 tokens',
    '(or add a "BREAKING CHANGE:" footer). No emoji — plain Conventional Commits only.',
    '',
    'Valid examples:',
    '  feat(docker): add health check endpoint',
    '  fix: resolve socket EACCES (#38)',
    '  refactor(store): simplify collection init',
    '',
    'Allowed types:',
    allowedTypes,
    '',
    'Validation errors:',
    formattedErrors,
    '',
    'AI_ACTION_REQUIRED: rewrite the commit subject to match the required format exactly.',
    'Fix command:',
    '  git commit --amend -m "feat(scope): concise imperative description"',
    '',
  ].join('\n');
}
