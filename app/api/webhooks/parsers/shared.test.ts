import { describe, expect, test } from 'vitest';
import { extractImageFromRepositoryUrl, splitSubjectImageAndTag } from './shared.js';

describe('api/webhooks/parsers/shared', () => {
  describe('extractImageFromRepositoryUrl', () => {
    test('returns undefined for empty-like input', () => {
      expect(extractImageFromRepositoryUrl(undefined)).toBeUndefined();
      expect(extractImageFromRepositoryUrl('   ')).toBeUndefined();
    });

    test('returns undefined when URL path is empty', () => {
      expect(extractImageFromRepositoryUrl('https://')).toBeUndefined();
      expect(extractImageFromRepositoryUrl('http://')).toBeUndefined();
    });
  });

  describe('splitSubjectImageAndTag', () => {
    test('returns undefined for blank subject values', () => {
      expect(splitSubjectImageAndTag('   ')).toBeUndefined();
      expect(splitSubjectImageAndTag(undefined)).toBeUndefined();
    });

    test('returns undefined when image or tag segment is empty after trimming', () => {
      expect(splitSubjectImageAndTag('repository/image:   ')).toBeUndefined();
      expect(splitSubjectImageAndTag('   :latest')).toBeUndefined();
    });
  });
});
