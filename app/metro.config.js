// Expo + npm-workspaces setup (see https://docs.expo.dev/guides/monorepos/).
// Lets Metro resolve /packages/core-posting from source without a build step.
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;
// core-posting's "exports" map has a "react-native" condition pointing at its
// TypeScript source, so the app always builds against the same files the
// package's Node tests run against.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
