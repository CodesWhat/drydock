import { AgentClient } from './AgentClient.js';

const client = new AgentClient('typecheck-agent', {
  host: 'localhost',
  port: 3001,
  secret: 'typecheck-secret',
});

// @ts-expect-error `log` is private and should not be externally accessible.
client.log.info('typecheck');
