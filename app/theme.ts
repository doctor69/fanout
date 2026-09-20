import { useColorScheme } from 'react-native';

/**
 * Light and dark palettes, chosen by the OS setting.
 *
 * There is deliberately no in-app theme switch: `userInterfaceStyle` is
 * "automatic" in app.json, so the app follows whatever the person already set
 * for their phone. One less setting to explain, and it matches what every
 * other app on their home screen does.
 */

export interface Colors {
  /** Page background. */
  ground: string;
  /** Cards, rows, anything sitting on the ground. */
  surface: string;
  /** Inset wells — chips, thumbnails, code-ish blocks. */
  sunk: string;
  text: string;
  textSoft: string;
  textFaint: string;
  line: string;
  /** Primary action (Post, Connect). */
  action: string;
  onAction: string;
  actionDisabled: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  /** Selected platform chip in the composer. */
  chip: string;
  chipBorder: string;
  chipText: string;
}

const light: Colors = {
  ground: '#f5f6f8',
  surface: '#ffffff',
  sunk: '#eef0f4',
  text: '#15181d',
  textSoft: '#5b6472',
  textFaint: '#98a1af',
  line: '#e2e6ec',
  action: '#1f1f1f',
  onAction: '#ffffff',
  actionDisabled: '#c4c8ce',
  success: '#15803d',
  successSoft: '#e6f4ea',
  warning: '#a55f00',
  warningSoft: '#fdf3e3',
  danger: '#b3261e',
  dangerSoft: '#fdecef',
  chip: '#e8f0fe',
  chipBorder: '#c5d9fb',
  chipText: '#1a4fa0',
};

const dark: Colors = {
  ground: '#0f1216',
  surface: '#191d23',
  sunk: '#232931',
  text: '#e9edf3',
  textSoft: '#a2acba',
  textFaint: '#727c8a',
  line: '#2b323b',
  action: '#e9edf3',
  onAction: '#15181d',
  actionDisabled: '#3a424c',
  success: '#5ec47f',
  successSoft: '#12291b',
  warning: '#e0a955',
  warningSoft: '#2c2415',
  danger: '#f2857f',
  dangerSoft: '#2e1618',
  chip: '#17304f',
  chipBorder: '#25476f',
  chipText: '#9cc2f5',
};

export function useColors(): Colors {
  // `useColorScheme` can report null before the OS setting resolves; light is
  // the safer first paint of the two.
  return useColorScheme() === 'dark' ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === 'dark';
}

export const palettes = { light, dark };
