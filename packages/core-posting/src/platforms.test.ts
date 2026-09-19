import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PLATFORMS, PLATFORM_LABELS, isPlatform } from './platforms';

test('exposes exactly the six v1 platforms', () => {
  assert.equal(PLATFORMS.length, 6);
  assert.deepEqual([...PLATFORMS].sort(), [
    'facebook',
    'instagram',
    'linkedin',
    'tiktok',
    'x',
    'youtube',
  ]);
});

test('every platform has a display label', () => {
  for (const platform of PLATFORMS) {
    assert.equal(typeof PLATFORM_LABELS[platform], 'string');
    assert.ok(PLATFORM_LABELS[platform].length > 0);
  }
  assert.equal(Object.keys(PLATFORM_LABELS).length, PLATFORMS.length);
});

test('isPlatform accepts known platforms and rejects everything else', () => {
  assert.equal(isPlatform('youtube'), true);
  assert.equal(isPlatform('YouTube'), false);
  assert.equal(isPlatform('threads'), false);
  assert.equal(isPlatform(undefined), false);
  assert.equal(isPlatform(42), false);
});
