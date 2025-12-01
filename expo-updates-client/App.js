import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Image } from 'react-native';
import Constants from 'expo-constants';

export default function App() {
  return (
    <View style={styles.container}>
      <Text>OTA updateeeeee!</Text>
      <Text>Open up App.js to start working on your app 6!</Text>
      <Text>{Constants.expoConfig.name}</Text>
      <Image source={require('./assets/favicon.png')} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#c75757ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
