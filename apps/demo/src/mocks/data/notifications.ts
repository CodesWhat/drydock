export const notificationRules = [
  {
    id: 'rule-1',
    name: 'All Updates',
    description: 'Notify on all container updates',
    enabled: true,
    triggers: ['slack.homelab', 'discord.updates'],
  },
  {
    id: 'rule-2',
    name: 'Security Alerts',
    description: 'Notify on critical/high CVEs',
    enabled: true,
    triggers: ['slack.homelab', 'smtp.email'],
  },
  {
    id: 'rule-3',
    name: 'Major Updates Only',
    description: 'Notify only on major version updates',
    enabled: false,
    triggers: ['http.webhook'],
  },
  {
    id: 'rule-4',
    name: 'Infra Stack',
    description: 'Notify on infrastructure container updates',
    enabled: true,
    triggers: ['discord.updates'],
  },
  {
    id: 'rule-5',
    name: 'Media Stack',
    description: 'Notify on media container updates',
    enabled: true,
    triggers: ['slack.homelab'],
  },
];
