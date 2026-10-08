import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import DashboardScreen from './src/screens/DashboardScreen';

export default function App() {
  return (
    <SafeAreaProvider>
      <DashboardScreen />
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}