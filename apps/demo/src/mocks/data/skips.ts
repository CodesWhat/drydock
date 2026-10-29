export interface DemoTriggerSkip {
  containerId: string;
  containerName: string | null;
  reason:
    | 'rule-disabled'
    | 'threshold-not-met'
    | 'trigger-excluded'
    | 'once-already-sent'
    | 'recently-applied'
    | 'digest-buffered';
  at: string;
}

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Skips keyed by trigger id. Container ids match `data/containers.ts`. */
export function createTriggerSkipSeed(): Record<string, DemoTriggerSkip[]> {
  return {
    'slack.homelab': [
      {
        containerId: 'e5f6a7b8c9d0',
        containerName: 'node-exporter',
        reason: 'threshold-not-met',
        at: ago(12),
      },
      {
        containerId: 'b2c3d4e5f6a7',
        containerName: 'prometheus',
        reason: 'once-already-sent',
        at: ago(95),
      },
      {
        containerId: 'd4e5f6a7b8c9',
        containerName: 'alertmanager',
        reason: 'recently-applied',
        at: ago(240),
      },
    ],
    'discord.updates': [
      {
        containerId: 'f6a7b8c9d0e1',
        containerName: 'jellyfin',
        reason: 'digest-buffered',
        at: ago(30),
      },
      {
        containerId: 'a7b8c9d0e1f2',
        containerName: 'sonarr',
        reason: 'trigger-excluded',
        at: ago(180),
      },
    ],
  };
}
