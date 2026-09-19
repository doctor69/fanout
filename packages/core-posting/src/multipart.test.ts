import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildMultipartBody } from './multipart';

test('writes each field with its own headers and a closing boundary', async () => {
  const { body, contentType } = buildMultipartBody([
    { name: 'segment_index', value: '0' },
    {
      name: 'media',
      value: new Blob(['chunk-bytes']),
      filename: 'chunk',
      contentType: 'application/octet-stream',
    },
  ]);

  const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
  assert.ok(boundary, 'content type must declare the boundary');

  const text = await body.text();
  assert.match(text, /Content-Disposition: form-data; name="segment_index"\r\n\r\n0\r\n/);
  assert.match(
    text,
    /Content-Disposition: form-data; name="media"; filename="chunk"\r\nContent-Type: application\/octet-stream\r\n\r\nchunk-bytes\r\n/,
  );
  assert.ok(text.endsWith(`--${boundary}--\r\n`));
  assert.equal(text.split(`--${boundary}`).length - 1, 3, 'two parts plus the terminator');
});

test('uses a fresh boundary per body', () => {
  const first = buildMultipartBody([{ name: 'a', value: '1' }]);
  const second = buildMultipartBody([{ name: 'a', value: '1' }]);

  assert.notEqual(first.contentType, second.contentType);
});
