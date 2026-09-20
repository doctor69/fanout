import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './navigation';
import ComposerScreen from './screens/ComposerScreen';
import ConnectionsScreen from './screens/ConnectionsScreen';
import HomeScreen from './screens/HomeScreen';
import { useColors, useIsDark } from './theme';

// Closes the auth session popup if the app is reloaded mid-flow.
WebBrowser.maybeCompleteAuthSession();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  const colors = useColors();
  const isDark = useIsDark();

  // Hand the palette to React Navigation too, so headers and the screen
  // background follow the OS setting rather than staying light underneath.
  const base = isDark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.chipText,
      background: colors.ground,
      card: colors.surface,
      text: colors.text,
      border: colors.line,
    },
  };

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={navTheme}>
        <Stack.Navigator>
          <Stack.Screen
            name="Home"
            component={HomeScreen}
            options={({ navigation }) => ({
              title: 'Fanout',
              headerRight: () => (
                <Pressable
                  onPress={() => navigation.navigate('Connections')}
                  accessibilityRole="button"
                >
                  <Text style={[styles.headerAction, { color: colors.chipText }]}>Accounts</Text>
                </Pressable>
              ),
            })}
          />
          <Stack.Screen name="Composer" component={ComposerScreen} options={{ title: 'New post' }} />
          <Stack.Screen
            name="Connections"
            component={ConnectionsScreen}
            options={{ title: 'Accounts' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      {/* "auto" flips the status bar text with the OS theme. */}
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  headerAction: { fontSize: 16, fontWeight: '600' },
});
