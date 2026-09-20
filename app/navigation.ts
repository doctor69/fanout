/**
 * Screen list for the root stack (specs/01-architecture.md).
 *
 * Post results render inline on the composer rather than on a screen of their
 * own, which specs/04-posting-flow.md allows and which keeps each platform's
 * retry next to its chip.
 *
 * `reconnect` carries the deep link specs/04 asks for when a platform's grant
 * has died: the composer sends the user here pointed at that platform.
 */
import type { Platform } from '@fanout/core-posting';

export type RootStackParamList = {
  Home: undefined;
  Composer: undefined;
  Connections: { reconnect?: Platform } | undefined;
};
