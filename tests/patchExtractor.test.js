import { describe, expect, test } from 'vitest';
import { extractFirstPublicEmail } from '../extension/core/patchExtractor.js';

describe('extractFirstPublicEmail', () => {
  test('extracts From email', () => {
    const patch = 'From: A User <user@example.com>\\n';
    expect(extractFirstPublicEmail(patch)).toBe('user@example.com');
  });

  test('extracts co-authored-by email', () => {
    const patch = 'Co-authored-by: Dev A <dev@example.com>\\n';
    expect(extractFirstPublicEmail(patch)).toBe('dev@example.com');
  });

  test('filters noreply addresses and returns next valid', () => {
    const patch = [
      'From: A <123+abc@users.noreply.github.com>',
      'Co-authored-by: B <b@example.com>'
    ].join('\\n');

    expect(extractFirstPublicEmail(patch)).toBe('b@example.com');
  });

  test('returns null when no public email exists', () => {
    const patch = 'From: A <noreply@github.com>\\n';
    expect(extractFirstPublicEmail(patch)).toBeNull();
  });
});
