import { daysToMs } from '../../utils/time';

export interface DemoGroupPolicy {
  id: string;
  group: string;
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  updatePolicy: {
    maturityMode?: 'all' | 'mature';
    maturityMinAgeDays?: number;
    maturitySkipReleases?: number;
    maturityReleaseFallbackDays?: number;
    skipTags?: string[];
    skipDigests?: string[];
  };
  actions: { updateMode?: 'manual' | 'notify'; exclude?: string[] };
}

export function createGroupPolicySeed(): DemoGroupPolicy[] {
  const created = new Date(Date.now() - daysToMs(14)).toISOString();
  return [
    {
      id: 'demo-gp-monitoring',
      group: 'monitoring',
      revision: 1,
      createdAt: created,
      createdBy: 'demo',
      updatedAt: created,
      updatedBy: 'demo',
      updatePolicy: { maturityMode: 'mature', maturityMinAgeDays: 7 },
      actions: { updateMode: 'notify' },
    },
  ];
}
