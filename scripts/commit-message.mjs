const COMMIT_TYPES = {
  feat: { emoji: '✨', purpose: 'new feature' },
  fix: { emoji: '🐛', purpose: 'bug fix' },
  docs: { emoji: '📝', purpose: 'documentation change' },
  style: { emoji: '💄', purpose: 'style/cosmetic change' },
  refactor: { emoji: '♻️', purpose: 'refactor without behavior change' },
  perf: { emoji: '⚡', purpose: 'performance improvement' },
  test: { emoji: '✅', purpose: 'test change' },
  chore: { emoji: '🔧', purpose: 'tooling/config change' },
  security: { emoji: '🔒', purpose: 'security fix' },
  deps: { emoji: '⬆️', purpose: 'dependency change' },
  revert: { emoji: '🗑️', purpose: 'intentional revert' },
};

const subjectRegex =
  /^(?<emoji>✨|🐛|📝|💄|♻️|⚡|✅|🔧|🔒|⬆️|🗑️)\s(?<type>feat|fix|docs|style|refactor|perf|test|chore|security|deps|revert)(?:\((?<scope>[a-z0-9][a-z0-9._/-]*)\))?:\s(?<description>.+)$/u;

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

  const errors = [];
  const match = subject.match(subjectRegex);

  if (!match?.groups) {
    if (!/^\p{Emoji}/u.test(subject)) {
      errors.push('Missing required emoji (gitmoji) prefix.');
    }
    if (
      !/\s(feat|fix|docs|style|refactor|perf|test|chore|security|deps|revert)(\(|:)/u.test(subject)
    ) {
      errors.push('Missing or unsupported commit type.');
    }
    errors.push('Subject does not match required format.');

    return { valid: false, errors };
  }

  const { emoji, type, description } = match.groups;
  const expectedEmoji = COMMIT_TYPES[type]?.emoji;
  if (expectedEmoji && emoji !== expectedEmoji) {
    errors.push(
      `Invalid emoji/type pair. Expected "${expectedEmoji} ${type}" but got "${emoji} ${type}".`,
    );
  }

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

  const allowedPairs = Object.entries(COMMIT_TYPES)
    .map(([type, meta]) => `  ${meta.emoji} ${type}: ${meta.purpose}`)
    .join('\n');

  const formattedErrors = errors.map((error) => `  - ${error}`).join('\n');

  return [
    '❌ Invalid commit message.',
    '',
    `Current subject: ${subject || '<empty>'}`,
    '',
    'Required subject format:',
    '  <emoji> <type>(<scope>): <description>',
    '',
    'Valid examples:',
    '  ✨ feat(docker): add health check endpoint',
    '  🐛 fix: resolve socket EACCES (#38)',
    '  ♻️ refactor(store): simplify collection init',
    '',
    'Allowed emoji/type pairs:',
    allowedPairs,
    '',
    'Validation errors:',
    formattedErrors,
    '',
    'AI_ACTION_REQUIRED: rewrite the commit subject to match the required format exactly.',
    'Fix command:',
    '  git commit --amend -m "✨ feat(scope): concise imperative description"',
    '',
  ].join('\n');
}
