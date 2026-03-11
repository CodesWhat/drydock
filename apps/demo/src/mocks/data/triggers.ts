export const triggers = [
  {
    id: 'slack.homelab',
    type: 'slack',
    name: 'homelab',
    configuration: {
      channel: '#homelab-updates',
      url: 'https://example.com/slack-webhook-placeholder',
    },
  },
  {
    id: 'discord.updates',
    type: 'discord',
    name: 'updates',
    configuration: {
      webhookUrl:
        'https://discord.com/api/webhooks/000000000000000000/XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
    },
  },
  {
    id: 'http.webhook',
    type: 'http',
    name: 'webhook',
    configuration: {
      url: 'https://automation.local/api/webhook/drydock',
      method: 'POST',
    },
  },
  {
    id: 'smtp.email',
    type: 'smtp',
    name: 'email',
    configuration: {
      host: 'smtp.gmail.com',
      port: 587,
      to: 'admin@example.com',
      from: 'drydock@example.com',
    },
  },
];
