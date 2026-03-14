import { describe, expect, it } from 'vitest';
import { useContainerBackups } from '@/views/containers/useContainerBackups';
import { useContainerPolicy } from '@/views/containers/useContainerPolicy';
import { useContainerPreview } from '@/views/containers/useContainerPreview';
import { useContainerTriggers } from '@/views/containers/useContainerTriggers';

describe('container action focused composables', () => {
  it('exports policy, preview, triggers, and backups composables', () => {
    expect(typeof useContainerPolicy).toBe('function');
    expect(typeof useContainerPreview).toBe('function');
    expect(typeof useContainerTriggers).toBe('function');
    expect(typeof useContainerBackups).toBe('function');
  });
});
