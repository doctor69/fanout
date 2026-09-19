/**
 * Screen list for the root stack. ComposerScreen and PostResultScreen join in
 * Phase 2 (specs/06-build-plan.md); the Reconnect deep link in
 * specs/04-posting-flow.md routes back to Connections with a platform param.
 */
import type { Platform } from '@fanout/core-posting';

export type RootStackParamList = {
  Connections: { reconnect?: Platform } | undefined;
};
