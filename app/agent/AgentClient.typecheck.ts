import { AgentClient } from './AgentClient.js';

const client = new AgentClient('typecheck-agent', {
  host: 'localhost',
  port: 3001,
  secret: 'typecheck-secret',
});

client.log.info('typecheck');
// @ts-expect-error `log` must be strongly typed and reject unknown logger methods.
client.log.notARealMethod('typecheck');
