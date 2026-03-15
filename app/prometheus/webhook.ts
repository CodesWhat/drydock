import { createCounter } from './counter-factory.js';

const { init, getCounter: getWebhookCounter } = createCounter(
  'dd_webhook_total',
  'Total count of webhook operations',
  ['action'],
);

export { getWebhookCounter, init };
