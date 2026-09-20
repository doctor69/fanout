import type { Platform } from '@fanout/core-posting';
import { PLATFORM_LABELS } from '@fanout/core-posting';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { RootStackParamList } from '../navigation';
import { HISTORY_LIMIT, loadHistory, type PostRecord } from '../services/postHistory';
import { useColors, type Colors } from '../theme';

/**
 * What went where. A reverse-chronological feed of past posts, each showing
 * the caption, the media and how every platform responded.
 *
 * It is capped at HISTORY_LIMIT entries — old posts fall off the end rather
 * than the list growing without bound on someone's phone.
 */

type Navigation = NativeStackNavigationProp<RootStackParamList, 'Home'>;

function relativeTime(when: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - when) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(when).toLocaleDateString();
}

function MediaThumb({ record, styles }: { record: PostRecord; styles: Styles }) {
  const [failed, setFailed] = useState(false);
  // Videos have no still to show without a thumbnailing library, and a picked
  // file's URI can stop resolving once the OS clears its cache — both land here.
  const showImage = record.mediaType === 'image' && record.mediaUri && !failed;

  return (
    <View style={styles.thumb}>
      {showImage ? (
        <Image
          source={{ uri: record.mediaUri }}
          style={styles.thumbImage}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={styles.thumbLabel}>{record.mediaType === 'video' ? 'Video' : 'Photo'}</Text>
      )}
    </View>
  );
}

function ResultChip({
  platform,
  status,
  styles,
}: {
  platform: Platform;
  status: 'success' | 'failure' | 'pending';
  styles: Styles;
}) {
  const tone =
    status === 'success' ? styles.chipOk : status === 'failure' ? styles.chipBad : styles.chipIdle;
  const mark = status === 'success' ? '✓' : status === 'failure' ? '!' : '·';

  return (
    <View style={[styles.chip, tone]}>
      <Text style={[styles.chipMark, status === 'failure' && styles.chipMarkBad]}>{mark}</Text>
      <Text style={styles.chipText}>{PLATFORM_LABELS[platform]}</Text>
    </View>
  );
}

function PostCard({ record, styles }: { record: PostRecord; styles: Styles }) {
  const succeeded = record.results.filter((r) => r.status === 'success').length;
  const failed = record.results.filter((r) => r.status === 'failure');

  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <MediaThumb record={record} styles={styles} />
        <View style={styles.cardText}>
          <Text style={styles.time}>{relativeTime(record.postedAt)}</Text>
          {record.caption ? (
            <Text style={styles.caption} numberOfLines={3}>
              {record.caption}
            </Text>
          ) : (
            <Text style={styles.captionEmpty}>No caption</Text>
          )}
          <Text style={styles.summary}>
            {succeeded} of {record.results.length} posted
          </Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        {record.results.map((result) => (
          <ResultChip
            key={result.platform}
            platform={result.platform}
            status={result.status}
            styles={styles}
          />
        ))}
      </View>

      {failed.map((failure) => (
        <Text key={failure.platform} style={styles.failure} numberOfLines={2}>
          {PLATFORM_LABELS[failure.platform]}: {failure.error ?? 'failed'}
        </Text>
      ))}
    </View>
  );
}

export default function HomeScreen() {
  const navigation = useNavigation<Navigation>();
  const colors = useColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [records, setRecords] = useState<PostRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setRecords(await loadHistory());
    setLoading(false);
  }, []);

  // Re-read on focus so a post made on the composer shows up on the way back.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (loading) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator style={styles.loading} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <FlatList
        data={records}
        keyExtractor={(record) => record.id}
        renderItem={({ item }) => <PostCard record={item} styles={styles} />}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Nothing posted yet</Text>
            <Text style={styles.emptyBody}>
              Posts you send from here show up in this list, with how each platform responded.
            </Text>
          </View>
        }
        ListFooterComponent={
          records.length >= HISTORY_LIMIT ? (
            <Text style={styles.footer}>
              Showing the most recent {HISTORY_LIMIT} posts. Older ones are not kept.
            </Text>
          ) : null
        }
      />

      <View style={styles.bar}>
        <Pressable style={styles.primary} onPress={() => navigation.navigate('Composer')}>
          <Text style={styles.primaryText}>New post</Text>
        </Pressable>
      </View>
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function createStyles(c: Colors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.ground },
    loading: { marginTop: 48 },
    list: { padding: 16, paddingBottom: 24, gap: 12 },

    empty: { alignItems: 'center', paddingTop: 72, paddingHorizontal: 24, gap: 8 },
    emptyTitle: { fontSize: 19, fontWeight: '700', color: c.text },
    emptyBody: { fontSize: 15, color: c.textSoft, textAlign: 'center', lineHeight: 21 },

    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      padding: 14,
      gap: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.line,
    },
    cardTop: { flexDirection: 'row', gap: 12 },
    cardText: { flex: 1, minWidth: 0, gap: 3 },

    thumb: {
      width: 68,
      height: 68,
      borderRadius: 10,
      backgroundColor: c.sunk,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    thumbImage: { width: '100%', height: '100%' },
    thumbLabel: { fontSize: 12, fontWeight: '600', color: c.textFaint },

    time: { fontSize: 12, color: c.textFaint, fontWeight: '600' },
    caption: { fontSize: 15, color: c.text, lineHeight: 20 },
    captionEmpty: { fontSize: 15, color: c.textFaint, fontStyle: 'italic' },
    summary: { fontSize: 13, color: c.textSoft, marginTop: 2 },

    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingVertical: 4,
      paddingHorizontal: 9,
      borderRadius: 14,
    },
    chipIdle: { backgroundColor: c.sunk },
    chipOk: { backgroundColor: c.successSoft },
    chipBad: { backgroundColor: c.dangerSoft },
    chipMark: { fontSize: 12, fontWeight: '700', color: c.success },
    chipMarkBad: { color: c.danger },
    chipText: { fontSize: 12.5, fontWeight: '600', color: c.textSoft },

    failure: { fontSize: 13, color: c.danger, lineHeight: 18 },

    footer: {
      fontSize: 12.5,
      color: c.textFaint,
      textAlign: 'center',
      paddingVertical: 18,
      paddingHorizontal: 24,
      lineHeight: 18,
    },

    bar: {
      padding: 16,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.line,
      backgroundColor: c.surface,
    },
    primary: {
      backgroundColor: c.action,
      borderRadius: 12,
      paddingVertical: 14,
      alignItems: 'center',
    },
    primaryText: { color: c.onAction, fontSize: 16, fontWeight: '600' },
  });
}
