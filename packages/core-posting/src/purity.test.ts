/**
 * Guards the non-negotiable from CLAUDE.md / specs/01-architecture.md:
 * this package must stay runnable in plain Node, so no mobile-runtime imports.
 *
 * This test file itself runs in plain Node after `tsc` — the fact that it
 * executes at all is half the proof; the scan below is the other half.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const SRC_DIR = path.join(__dirname, '..', 'src');

const FORBIDDEN = [
  'react-native',
  'react',
  'expo',
  'expo-secure-store',
  'expo-auth-session',
  '@react-navigation',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') ? [full] : [];
  });
}

test('no source file imports a mobile-only runtime', () => {
  const files = sourceFiles(SRC_DIR);
  assert.ok(files.length > 0, 'expected to find source files to scan');

  const importRe = /(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g;
  const offenders: string[] = [];

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(importRe)) {
      const specifier = match[1] ?? '';
      const pkg = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0] ?? '';
      if (FORBIDDEN.includes(pkg)) {
        offenders.push(`${path.relative(SRC_DIR, file)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(offenders, [], `mobile-only imports found:\n${offenders.join('\n')}`);
});

test('package.json declares no runtime dependencies', () => {
  const pkg = JSON.parse(
    readFileSync(path.join(SRC_DIR, '..', 'package.json'), 'utf8'),
  ) as { dependencies?: Record<string, string> };

  assert.deepEqual(pkg.dependencies ?? {}, {});
});
