import { daysToMs } from '../../utils/time';

export interface DemoApiKey {
  keyId: string;
  name: string;
  displayPrefix: string;
  scopes: string[];
  status: 'active' | 'revoked' | 'expired';
  createdAt: string;
  createdBy: string;
  parentKeyId: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  revokedBy?: string;
  rateLimitMax?: number;
}

const ago = (days: number) => new Date(Date.now() - daysToMs(days)).toISOString();

export function createApiKeySeed(): DemoApiKey[] {
  return [
    {
      keyId: 'demo-key-ci',
      name: 'ci-readonly',
      displayPrefix: 'dd_demo_a1b2',
      scopes: ['read'],
      status: 'active',
      createdAt: ago(21),
      createdBy: 'demo',
      parentKeyId: null,
      expiresAt: null,
      lastUsedAt: ago(0.1),
      revokedAt: null,
    },
    {
      keyId: 'demo-key-homepage',
      name: 'homepage-dashboard',
      displayPrefix: 'dd_demo_c3d4',
      scopes: ['read', 'containers:watch'],
      status: 'active',
      createdAt: ago(9),
      createdBy: 'demo',
      parentKeyId: null,
      expiresAt: new Date(Date.now() + daysToMs(80)).toISOString(),
      lastUsedAt: ago(1),
      revokedAt: null,
      rateLimitMax: 600,
    },
    {
      keyId: 'demo-key-old',
      name: 'legacy-script',
      displayPrefix: 'dd_demo_e5f6',
      scopes: ['read', 'containers:update'],
      status: 'revoked',
      createdAt: ago(120),
      createdBy: 'demo',
      parentKeyId: null,
      expiresAt: null,
      lastUsedAt: ago(60),
      revokedAt: ago(45),
      revokedBy: 'demo',
    },
  ];
}
