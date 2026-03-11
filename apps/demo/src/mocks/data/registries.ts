export const registries = [
  {
    id: 'hub.public',
    type: 'hub',
    name: 'public',
    configuration: { auth: 'anonymous' },
  },
  {
    id: 'ghcr.private',
    type: 'ghcr',
    name: 'private',
    configuration: { token: '***' },
  },
  {
    id: 'quay.public',
    type: 'quay',
    name: 'public',
    configuration: { auth: 'anonymous' },
  },
  {
    id: 'lscr.public',
    type: 'lscr',
    name: 'public',
    configuration: { auth: 'anonymous' },
  },
];
