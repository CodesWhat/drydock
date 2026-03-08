import type { applyRadius } from '@/preferences/radius';

type RadiusParam = Parameters<typeof applyRadius>[0];
type ExpectedRadiusPresetId = 'none' | 'sharp' | 'modern' | 'soft' | 'round';

type IsRadiusParamExpected = [RadiusParam] extends [ExpectedRadiusPresetId]
  ? [ExpectedRadiusPresetId] extends [RadiusParam]
    ? true
    : false
  : false;

const applyRadiusParamMatchesExpected: IsRadiusParamExpected = true;
void applyRadiusParamMatchesExpected;
