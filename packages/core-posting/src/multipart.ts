/**
 * Builds a multipart/form-data body as a Blob.
 *
 * FormData is not the same object in Node and in React Native — RN's version
 * wants `{ uri, name, type }` file parts and doesn't reliably carry a Blob —
 * so this package assembles the body itself. A Blob built from a file-backed
 * Blob keeps the bytes on the native side in RN, which is what lets a large
 * video upload without passing through JS memory.
 */

export interface MultipartField {
  name: string;
  value: string | Blob;
  /** Filename to declare for a Blob part; platforms generally require one. */
  filename?: string;
  contentType?: string;
}

export interface MultipartBody {
  body: Blob;
  contentType: string;
}

function randomBoundary(): string {
  const suffix = Array.from({ length: 4 }, () =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, '0'),
  ).join('');
  return `----fanout${suffix}`;
}

export function buildMultipartBody(fields: MultipartField[]): MultipartBody {
  const boundary = randomBoundary();
  const parts: (string | Blob)[] = [];

  for (const field of fields) {
    let headers = `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"`;
    if (field.filename) headers += `; filename="${field.filename}"`;
    headers += '\r\n';
    if (field.contentType) headers += `Content-Type: ${field.contentType}\r\n`;
    headers += '\r\n';

    parts.push(headers, field.value, '\r\n');
  }

  parts.push(`--${boundary}--\r\n`);

  return {
    body: new Blob(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}
