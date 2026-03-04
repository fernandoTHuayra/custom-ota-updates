import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { StyleSheet, Text, View, Image, Pressable } from "react-native";
import Constants from "expo-constants";
import * as Updates from "expo-updates";

export default function App() {
  const [status, setStatus] = useState("Idle");
  const [lastCheck, setLastCheck] = useState("-");

  const checkAndApplyUpdate = async () => {
    try {
      setStatus("Checking for update...");
      setLastCheck(new Date().toISOString());

      const update = await Updates.checkForUpdateAsync();
      if (!update.isAvailable) {
        setStatus("No update available");
        return;
      }

      setStatus("Update found. Downloading...");
      const result = await Updates.fetchUpdateAsync();
      if (result.isNew) {
        setStatus("Update downloaded. Reloading app...");
        await Updates.reloadAsync();
      } else {
        setStatus("Checked, but no new update to apply");
      }
    } catch (error) {
      setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>TEST</Text>
      <Text style={styles.title}>OTA Diagnostics</Text>
      <Text style={styles.line}>App: {Constants.expoConfig.name}</Text>
      <Text style={styles.line}>Runtime: {Updates.runtimeVersion ?? "-"}</Text>
      <Text style={styles.line}>
        Update ID: {Updates.updateId ?? "(embedded)"}
      </Text>
      <Text style={styles.line}>
        Embedded launch: {String(Updates.isEmbeddedLaunch)}
      </Text>
      <Text style={styles.line}>Last check: {lastCheck}</Text>
      <Text style={styles.status}>Status: {status}</Text>

      <Pressable onPress={checkAndApplyUpdate} style={styles.button}>
        <Text style={styles.buttonText}>Check / Fetch / Reload</Text>
      </Pressable>

      <Image source={require("./assets/favicon.png")} />
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#c75757ff",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "white",
    marginBottom: 16,
  },
  line: {
    color: "white",
    marginBottom: 6,
    textAlign: "center",
  },
  status: {
    color: "#fff",
    marginTop: 10,
    marginBottom: 14,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#ffffff",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    marginBottom: 20,
  },
  buttonText: {
    fontWeight: "700",
    color: "#222",
  },
});
