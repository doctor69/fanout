import type { Platform, PostAttempt, PostResult } from '@fanout/core-posting';
import { PLATFORM_LABELS } from '@fanout/core-posting';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { RootStackParamList } from '../navigation';
import { postToPlatforms } from '../services/posting';
import { isVerified, useAccounts } from '../state/accountsStore';

/**
 * One post, fanned out (specs/04-posting-flow.md).
 *
 * Every connected platform starts opted in; tapping a chip opts that platform
 * out of this post only. Results land on the chips as each platform resolves,
 * which specs/04 allows in place of a separate result screen, and keeps the
 * per-platform retry next to the platform it retries.
 */

type Attempt = PostAttempt & { needsReconnect?: boolean };
type Navigation = NativeStackNavigationProp<RootStackParamList, 'Composer'>;

function toAttempt(result: PostResult): Attempt {
  return {
    platform: result.platform,
    status: result.status,
    ...(result.platformPostId ? { platformPostId: result.platformPostId } : {}),
    ...(result.error ? { error: result.error } : {}),
    ...(result.needsReconnect ? { needsReconnect: true } : {}),
  };
}

export default function ComposerScreen() {
  const navigation = useNavigation<Navigation>();
  const { accounts, loading, refresh } = useAccounts();

  const [asset, setAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [caption, setCaption] = useState('');
  /** Opt-outs rather than opt-ins, so a platform connected later is included by default. */
  const [optedOut, setOptedOut] = useState<Set<Platform>>(new Set());
  const [attempts, setAttempts] = useState<Partial<Record<Platform, Attempt>>>({});
  const [posting, setPosting] = useState(false);

  const connected = useMemo(
    () => accounts.filter(isVerified).map((account) => account.platform),
    [accounts],
  );
  const selected = connected.filter((platform) => !optedOut.has(platform));

  // "This selection is local to the current post only and resets to 'all
  // selected' the next time the composer opens" (specs/04).
  useFocusEffect(
    useCallback(() => {
      setOptedOut(new Set());
      void refresh();
    }, [refresh]),
  );

  const pick = async (from: 'library' | 'camera') => {
    const permission =
      from === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Permission needed',
        from === 'camera'
          ? 'Fanout needs camera access to shoot a post.'
          : 'Fanout needs photo access to pick a post.',
      );
      return;
    }

    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images', 'videos'] };
    const result =
      from === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);

    const picked = result.canceled ? undefined : result.assets[0];
    if (!picked) return;

    setAsset(picked);
    // A new piece of media means the previous post's results no longer apply.
    setAttempts({});
  };

  const post = async (targets: Platform[]) => {
    if (!asset || targets.length === 0) return;

    const mediaType: 'video' | 'image' = asset.type === 'video' ? 'video' : 'image';
    setPosting(true);
    setAttempts((current) => ({
      ...current,
      ...Object.fromEntries(
        targets.map((platform) => [platform, { platform, status: 'pending' as const }]),
      ),
    }));

    const record = (result: PostResult) =>
      setAttempts((current) => ({ ...current, [result.platform]: toAttempt(result) }));

    try {
      const results = await postToPlatforms(
        { caption, mediaUri: asset.uri, mediaType },
        targets,
        asset,
        record,
      );
      results.forEach(record);
    } catch (cause) {
      // fanOutPost itself failing (e.g. secure storage unreadable) is not a
      // per-platform failure, so it can't be shown on a chip.
      Alert.alert('Could not post', cause instanceof Error ? cause.message : String(cause));
      setAttempts({});
    } finally {
      setPosting(false);
    }
  };

  const toggle = (platform: Platform) => {
    if (posting) return;
    setOptedOut((current) => {
      const next = new Set(current);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  };

  const failures = connected
    .map((platform) => attempts[platform])
    .filter((attempt): attempt is Attempt => attempt?.status === 'failure');

  if (loading) {
    return <ActivityIndicator style={styles.loading} />;
  }

  if (connected.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>No accounts connected</Text>
        <Text style={styles.emptyBody}>
          Connect at least one account and every post you write here goes to all of them at once.
        </Text>
        <Pressable style={styles.primary} onPress={() => navigation.navigate('Connections')}>
          <Text style={styles.primaryText}>Connect an account</Text>
        </Pressable>
      </View>
    );
  }

  const canPost = asset !== null && selected.length > 0 && !posting;

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {asset ? (
        <View style={styles.preview}>
          <Image source={{ uri: asset.uri }} style={styles.previewImage} resizeMode="cover" />
          {asset.type === 'video' ? <Text style={styles.previewBadge}>Video</Text> : null}
        </View>
      ) : (
        <View style={styles.previewEmpty}>
          <Text style={styles.previewEmptyText}>No media attached</Text>
        </View>
      )}

      <View style={styles.pickRow}>
        <Pressable style={styles.secondary} onPress={() => void pick('library')} disabled={posting}>
          <Text style={styles.secondaryText}>{asset ? 'Change media' : 'Choose media'}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => void pick('camera')} disabled={posting}>
          <Text style={styles.secondaryText}>Camera</Text>
        </Pressable>
      </View>

      <TextInput
        style={styles.caption}
        placeholder="Write one caption for every platform…"
        value={caption}
        onChangeText={setCaption}
        multiline
        editable={!posting}
      />

      <Text style={styles.sectionLabel}>Posting to</Text>
      <View style={styles.chipRow}>
        {connected.map((platform) => {
          const attempt = attempts[platform];
          const off = optedOut.has(platform);
          return (
            <Pressable
              key={platform}
              onPress={() => toggle(platform)}
              style={[styles.chip, off && styles.chipOff, attempt?.status === 'failure' && styles.chipFailed]}
              accessibilityRole="button"
              accessibilityState={{ selected: !off }}
              accessibilityLabel={`${PLATFORM_LABELS[platform]}${off ? ', not included' : ', included'}`}
            >
              {attempt?.status === 'pending' ? (
                <ActivityIndicator size="small" />
              ) : (
                <Text style={styles.chipStatus}>
                  {attempt?.status === 'success' ? '✓' : attempt?.status === 'failure' ? '!' : off ? '' : '•'}
                </Text>
              )}
              <Text style={[styles.chipText, off && styles.chipTextOff]}>
                {PLATFORM_LABELS[platform]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Pressable
        style={[styles.primary, !canPost && styles.primaryDisabled]}
        onPress={() => void post(selected)}
        disabled={!canPost}
      >
        {posting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.primaryText}>
            Post to {selected.length} {selected.length === 1 ? 'account' : 'accounts'}
          </Text>
        )}
      </Pressable>

      {failures.map((failure) => (
        <View key={failure.platform} style={styles.failure}>
          <Text style={styles.failureTitle}>{PLATFORM_LABELS[failure.platform]} didn't post</Text>
          <Text style={styles.failureBody}>{failure.error}</Text>
          {failure.needsReconnect ? (
            <Pressable
              style={styles.secondary}
              onPress={() => navigation.navigate('Connections', { reconnect: failure.platform })}
            >
              <Text style={styles.secondaryText}>Reconnect {PLATFORM_LABELS[failure.platform]}</Text>
            </Pressable>
          ) : (
            // Retries this platform alone — the ones that already succeeded
            // are not posted again.
            <Pressable
              style={styles.secondary}
              onPress={() => void post([failure.platform])}
              disabled={posting}
            >
              <Text style={styles.secondaryText}>Retry {PLATFORM_LABELS[failure.platform]}</Text>
            </Pressable>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, gap: 14 },
  loading: { marginTop: 48 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 10 },
  emptyTitle: { fontSize: 20, fontWeight: '700' },
  emptyBody: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 21, marginBottom: 8 },
  preview: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#eee' },
  previewImage: { width: '100%', aspectRatio: 1 },
  previewBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    overflow: 'hidden',
  },
  previewEmpty: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderStyle: 'dashed',
    paddingVertical: 48,
    alignItems: 'center',
  },
  previewEmptyText: { color: '#999', fontSize: 15 },
  pickRow: { flexDirection: 'row', gap: 10 },
  caption: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#666', textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: '#e8f0fe',
    borderWidth: 1,
    borderColor: '#c5d9fb',
  },
  chipOff: { backgroundColor: '#f2f2f2', borderColor: '#e0e0e0' },
  chipFailed: { backgroundColor: '#fdecef', borderColor: '#f3c2cb' },
  chipStatus: { fontSize: 13, fontWeight: '700', color: '#1a4fa0' },
  chipText: { fontSize: 14, fontWeight: '600', color: '#1a4fa0' },
  chipTextOff: { color: '#999' },
  primary: {
    backgroundColor: '#1f1f1f',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryDisabled: { backgroundColor: '#c4c4c4' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  secondaryText: { fontSize: 14, fontWeight: '600' },
  failure: {
    backgroundColor: '#fdecef',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  failureTitle: { fontSize: 15, fontWeight: '700', color: '#8a1c2b' },
  failureBody: { fontSize: 14, color: '#6d2530', lineHeight: 20 },
});
