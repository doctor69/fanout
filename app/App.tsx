import { PLATFORMS, PLATFORM_LABELS } from '@fanout/core-posting';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

/**
 * Phase 0 placeholder. Phase 1 replaces this with ConnectionsScreen
 * (specs/04-posting-flow.md); the import above exists to prove the app
 * resolves /packages/core-posting through the workspace link.
 */
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Fanout</Text>
      <Text style={styles.subtitle}>Post once. Everywhere.</Text>
      {PLATFORMS.map((platform) => (
        <Text key={platform} style={styles.platform}>
          {PLATFORM_LABELS[platform]}
        </Text>
      ))}
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 32, fontWeight: '600' },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 24 },
  platform: { fontSize: 16, lineHeight: 28 },
});
