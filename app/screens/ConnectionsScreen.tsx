import type { Account, Platform } from '@fanout/core-posting';
import { PLATFORMS, PLATFORM_LABELS } from '@fanout/core-posting';
import { type RouteProp, useRoute } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { isConfigured, missingConfigFor } from '../config';
import type { RootStackParamList } from '../navigation';
import { type ConnectPhase, isConnectSupported, isVerified, useAccounts } from '../state/accountsStore';

/**
 * Fixed list of six rows (specs/04-posting-flow.md).
 *
 * The green checkmark is the app's claim that this account can be posted to,
 * so it appears only once the sign-in has been verified — signing in is not
 * enough on its own. Until then the row shows what it's doing ("Signing in",
 * "Verifying"), and a sign-in that can't be verified is never stored, so it
 * never shows a check.
 */

// Stand-ins until real platform icons are added; the row layout is what matters.
const PLATFORM_GLYPHS: Record<Platform, string> = {
  youtube: '▶',
  tiktok: '♪',
  instagram: '◎',
  facebook: 'f',
  x: '✕',
  linkedin: 'in',
};

const PHASE_LABELS: Record<ConnectPhase, string> = {
  connecting: 'Signing in\u2026',
  verifying: 'Verifying\u2026',
  disconnecting: 'Disconnecting\u2026',
};

interface RowProps {
  platform: Platform;
  account: Account | undefined;
  /** Highlighted because the composer sent the user here to fix this one. */
  highlighted?: boolean;
  phase: ConnectPhase | null;
  onConnect: () => void;
  onDisconnect: () => void;
}

function ConnectionRow({ platform, account, phase, highlighted, onConnect, onDisconnect }: RowProps) {
  const label = PLATFORM_LABELS[platform];
  const busy = phase !== null;
  // Verified is the only state that counts as connected in the UI.
  const connected = isVerified(account);
  const configured = isConfigured(platform);

  const confirmDisconnect = () => {
    Alert.alert(
      `Disconnect ${label}?`,
      'Fanout will forget this account and stop posting to it. You can reconnect any time.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: onDisconnect },
      ],
    );
  };

  const notYet = () => {
    Alert.alert(`${label} isn't ready yet`, 'This platform arrives in a later build phase.');
  };

  const notConfigured = () => {
    Alert.alert(
      `${label} isn't set up yet`,
      `This build has no ${label} app registered, so there's nothing to sign in to yet.\n\n` +
        `Set ${missingConfigFor(platform).join(' and ')} in app/.env, then restart with ` +
        '--clear.\n\ndocs/connecting-accounts.md has the steps.',
    );
  };

  const handlePress = () => {
    if (busy) return;
    if (connected) return confirmDisconnect();
    if (!isConnectSupported(platform)) return notYet();
    if (!configured) return notConfigured();
    // Covers both first connect and re-running the flow for an account that
    // was stored but never verified.
    onConnect();
  };

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        highlighted && styles.rowHighlighted,
        pressed && styles.rowPressed,
      ]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={
        busy
          ? `${label}, ${PHASE_LABELS[phase]}`
          : connected
            ? `${label}, connected and verified as ${account.displayName ?? 'your account'}`
            : `Connect ${label}`
      }
    >
      <View style={styles.glyph}>
        <Text style={styles.glyphText}>{PLATFORM_GLYPHS[platform]}</Text>
      </View>

      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{label}</Text>
        {busy ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {PHASE_LABELS[phase]}
          </Text>
        ) : connected ? (
          <Text style={styles.rowSubtitle} numberOfLines={1}>
            {account.displayName ?? 'Connected'}
          </Text>
        ) : account ? (
          <Text style={styles.rowWarning} numberOfLines={1}>
            Not verified — connect again
          </Text>
        ) : !configured ? (
          <Text style={styles.rowMuted} numberOfLines={1}>
            No {label} app registered yet
          </Text>
        ) : null}
      </View>

      {busy ? (
        <ActivityIndicator />
      ) : connected ? (
        <Text style={styles.check} accessibilityLabel="connected">
          ✓
        </Text>
      ) : configured ? (
        <View style={styles.connectButton}>
          <Text style={styles.connectButtonText}>Connect</Text>
        </View>
      ) : (
        <View style={styles.setupButton}>
          <Text style={styles.setupButtonText}>Set up</Text>
        </View>
      )}
    </Pressable>
  );
}

export default function ConnectionsScreen() {
  const { accounts, loading, busy, error, connect, disconnect } = useAccounts();
  const route = useRoute<RouteProp<RootStackParamList, 'Connections'>>();
  const reconnect = route.params?.reconnect;
  const byPlatform = new Map(accounts.map((account) => [account.platform, account]));

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.heading}>Accounts</Text>
      <Text style={styles.subheading}>
        Connect an account once. Every post fans out to all of them, unless you opt one out.
      </Text>

      {reconnect ? (
        <Text style={styles.notice}>
          {PLATFORM_LABELS[reconnect]} needs reconnecting before it can be posted to again.
        </Text>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <View style={styles.list}>
          {PLATFORMS.map((platform) => (
            <ConnectionRow
              key={platform}
              platform={platform}
              account={byPlatform.get(platform)}
              phase={busy?.platform === platform ? busy.phase : null}
              highlighted={reconnect === platform}
              onConnect={() => void connect(platform)}
              onDisconnect={() => void disconnect(platform)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingTop: 8 },
  heading: { fontSize: 28, fontWeight: '700', marginBottom: 4 },
  subheading: { fontSize: 14, color: '#666', marginBottom: 20, lineHeight: 20 },
  error: {
    fontSize: 14,
    color: '#b00020',
    backgroundColor: '#fdecef',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  loading: { marginTop: 32 },
  list: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#fafafa' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e2',
  },
  rowPressed: { backgroundColor: '#f0f0f0' },
  rowHighlighted: { backgroundColor: '#fff6e5' },
  notice: {
    fontSize: 14,
    color: '#7a4b00',
    backgroundColor: '#fff6e5',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  glyph: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#e8e8e8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  glyphText: { fontSize: 16, fontWeight: '600' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  rowSubtitle: { fontSize: 13, color: '#666', marginTop: 2 },
  rowWarning: { fontSize: 13, color: '#b26a00', marginTop: 2 },
  rowMuted: { fontSize: 13, color: '#999', marginTop: 2 },
  check: { fontSize: 20, color: '#1a8f3c', fontWeight: '700', paddingHorizontal: 6 },
  connectButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1f1f1f',
  },
  connectButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  setupButton: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#ccc',
  },
  setupButtonText: { color: '#777', fontSize: 14, fontWeight: '600' },
});
