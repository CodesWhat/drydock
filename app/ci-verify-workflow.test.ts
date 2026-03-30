import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'yaml';

interface WorkflowJob {
  name?: string;
}

interface WorkflowDefinition {
  jobs?: Record<string, WorkflowJob>;
}

const workflowPath = fileURLToPath(new URL('../.github/workflows/ci-verify.yml', import.meta.url));
const emojiPrefix = /^\p{Extended_Pictographic}/u;

test('ci-verify job names are emoji-prefixed for GitHub checks readability', () => {
  const workflow = yaml.parse(readFileSync(workflowPath, 'utf8')) as WorkflowDefinition;

  const jobsWithoutEmoji = Object.entries(workflow.jobs ?? {})
    .map(([jobId, job]) => ({
      jobId,
      name: job.name ?? '',
    }))
    .filter(({ name }) => !emojiPrefix.test(name));

  expect(jobsWithoutEmoji).toStrictEqual([]);
});
