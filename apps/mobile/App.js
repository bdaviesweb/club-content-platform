import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

const defaultConfig = {
  apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:4000",
  clubSlug: process.env.EXPO_PUBLIC_CLUB_SLUG || "demo-soccer-club",
  teamSlug: process.env.EXPO_PUBLIC_TEAM_SLUG || "u14-girls",
  submitterEmail:
    process.env.EXPO_PUBLIC_SUBMITTER_EMAIL || "coach@demo-club.local"
};

function normalizeApiBaseUrl(value) {
  return value.replace(/\/+$/, "");
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultConfig.apiBaseUrl);
  const [clubSlug, setClubSlug] = useState(defaultConfig.clubSlug);
  const [teamSlug, setTeamSlug] = useState(defaultConfig.teamSlug);
  const [submitterEmail, setSubmitterEmail] = useState(defaultConfig.submitterEmail);
  const [caption, setCaption] = useState("");
  const [visibilityTarget, setVisibilityTarget] = useState("internal");
  const [asset, setAsset] = useState(null);
  const [status, setStatus] = useState("Pick media, add a caption, and submit.");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = useMemo(() => {
    return Boolean(
      asset &&
        caption.trim() &&
        apiBaseUrl.trim() &&
        clubSlug.trim() &&
        submitterEmail.trim()
    );
  }, [asset, caption, apiBaseUrl, clubSlug, submitterEmail]);

  async function pickAsset() {
    const result = await DocumentPicker.getDocumentAsync({
      multiple: false,
      copyToCacheDirectory: true,
      type: ["image/*", "video/*"]
    });

    if (result.canceled || !result.assets?.length) {
      return;
    }

    const selected = result.assets[0];
    setAsset(selected);
    setStatus(`Selected ${selected.name}`);
  }

  function guessContentTypeFromAsset(selectedAsset) {
    if (selectedAsset?.mimeType?.startsWith("video/")) {
      return "video";
    }

    return "photo";
  }

  async function uploadSelectedAsset(uploadPlan, selectedAsset) {
    const uploadResponse = await FileSystem.uploadAsync(uploadPlan.uploadUrl, selectedAsset.uri, {
      httpMethod: uploadPlan.method,
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: uploadPlan.headers
    });

    if (uploadResponse.status < 200 || uploadResponse.status >= 300) {
      throw new Error(`Upload failed with status ${uploadResponse.status}`);
    }
  }

  async function submit() {
    if (!asset) {
      return;
    }

    setSubmitting(true);
    setStatus("Requesting upload URL...");

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());

      const signResponse = await fetch(`${baseUrl}/uploads/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubSlug,
          files: [
            {
              filename: asset.name,
              mimeType: asset.mimeType || "application/octet-stream",
              mediaType: guessContentTypeFromAsset(asset) === "video" ? "video" : "image"
            }
          ]
        })
      });

      if (!signResponse.ok) {
        throw new Error(`Upload signing failed: ${signResponse.status}`);
      }

      const signPayload = await signResponse.json();
      const uploadPlan = signPayload.uploads?.[0];

      if (!uploadPlan) {
        throw new Error("Upload signing returned no upload plan");
      }

      setStatus("Uploading media...");
      await uploadSelectedAsset(uploadPlan, asset);

      setStatus("Creating submission...");
      const submissionResponse = await fetch(`${baseUrl}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubSlug,
          teamSlug,
          submitterEmail,
          contentType: guessContentTypeFromAsset(asset),
          rawText: caption.trim(),
          visibilityTarget,
          media: [
            {
              objectKey: uploadPlan.objectKey,
              mediaType: guessContentTypeFromAsset(asset) === "video" ? "video" : "image",
              mimeType: asset.mimeType || "application/octet-stream"
            }
          ]
        })
      });

      if (!submissionResponse.ok) {
        throw new Error(`Submission failed: ${submissionResponse.status}`);
      }

      const submissionPayload = await submissionResponse.json();
      setStatus(`Submitted ${submissionPayload.submission.id}`);
      setCaption("");
      setAsset(null);
      Alert.alert("Submission created", submissionPayload.submission.id);
    } catch (error) {
      setStatus(error.message || "Submission failed");
      Alert.alert("Submission failed", error.message || "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>Mobile Submission</Text>
          <Text style={styles.title}>Club Content Capture</Text>
          <Text style={styles.subtitle}>
            Signed upload, content submission, and review handoff from one screen.
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <TextInput
            autoCapitalize="none"
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            placeholder="API base URL"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Club Context</Text>
          <TextInput style={styles.input} value={clubSlug} onChangeText={setClubSlug} placeholder="Club slug" />
          <TextInput style={styles.input} value={teamSlug} onChangeText={setTeamSlug} placeholder="Team slug" />
          <TextInput
            autoCapitalize="none"
            style={styles.input}
            value={submitterEmail}
            onChangeText={setSubmitterEmail}
            placeholder="Submitter email"
          />
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Submission</Text>
          <Pressable style={styles.secondaryButton} onPress={pickAsset}>
            <Text style={styles.secondaryButtonText}>
              {asset ? `Replace Media: ${asset.name}` : "Pick Photo or Video"}
            </Text>
          </Pressable>
          <TextInput
            multiline
            style={[styles.input, styles.textArea]}
            value={caption}
            onChangeText={setCaption}
            placeholder="Write the update or caption"
          />
          <View style={styles.visibilityRow}>
            {["internal", "public"].map((value) => (
              <Pressable
                key={value}
                style={[
                  styles.visibilityPill,
                  visibilityTarget === value && styles.visibilityPillActive
                ]}
                onPress={() => setVisibilityTarget(value)}
              >
                <Text
                  style={[
                    styles.visibilityPillText,
                    visibilityTarget === value && styles.visibilityPillTextActive
                  ]}
                >
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.statusText}>{status}</Text>
          <Pressable
            disabled={!canSubmit || submitting}
            style={[
              styles.primaryButton,
              (!canSubmit || submitting) && styles.primaryButtonDisabled
            ]}
            onPress={submit}
          >
            {submitting ? (
              <ActivityIndicator color="#fff7ef" />
            ) : (
              <Text style={styles.primaryButtonText}>Upload and Submit</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f7efe1"
  },
  container: {
    padding: 20,
    gap: 18
  },
  hero: {
    paddingTop: 12,
    paddingBottom: 8
  },
  kicker: {
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#a54b24",
    marginBottom: 8
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    color: "#17372c",
    fontWeight: "700"
  },
  subtitle: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 23,
    color: "#53635e"
  },
  card: {
    backgroundColor: "#fffaf2",
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e3d7c4",
    shadowColor: "#1b332a",
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#17372c",
    marginBottom: 12
  },
  input: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ded2c1",
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    marginBottom: 12
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top"
  },
  secondaryButton: {
    backgroundColor: "#f0e5d5",
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 12
  },
  secondaryButtonText: {
    color: "#7a4f2b",
    fontSize: 16,
    fontWeight: "600"
  },
  visibilityRow: {
    flexDirection: "row",
    gap: 10
  },
  visibilityPill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "#efe3d1"
  },
  visibilityPillActive: {
    backgroundColor: "#17372c"
  },
  visibilityPillText: {
    textTransform: "capitalize",
    color: "#755139",
    fontWeight: "600"
  },
  visibilityPillTextActive: {
    color: "#fffaf2"
  },
  statusText: {
    color: "#57645f",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 14
  },
  primaryButton: {
    backgroundColor: "#17372c",
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54
  },
  primaryButtonDisabled: {
    opacity: 0.5
  },
  primaryButtonText: {
    color: "#fff7ef",
    fontSize: 16,
    fontWeight: "700"
  }
});
