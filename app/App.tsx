import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import { Pressable, StyleSheet, Text } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { RootStackParamList } from './navigation';
import ComposerScreen from './screens/ComposerScreen';
import ConnectionsScreen from './screens/ConnectionsScreen';

// Closes the auth session popup if the app is reloaded mid-flow.
WebBrowser.maybeCompleteAuthSession();

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Stack.Navigator>
          <Stack.Screen
            name="Composer"
            component={ComposerScreen}
            options={({ navigation }) => ({
              title: 'New post',
              headerRight: () => (
                <Pressable
                  onPress={() => navigation.navigate('Connections')}
                  accessibilityRole="button"
                >
                  <Text style={styles.headerAction}>Accounts</Text>
                </Pressable>
              ),
            })}
          />
          <Stack.Screen
            name="Connections"
            component={ConnectionsScreen}
            options={{ title: 'Accounts' }}
          />
        </Stack.Navigator>
      </NavigationContainer>
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  headerAction: { fontSize: 16, fontWeight: '600' },
});
