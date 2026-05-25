import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
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

function formatSubmittedAt(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString();
}

function formatNotificationLabel(type) {
  return String(type || "update")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const canSubmit = useMemo(() => {
    return Boolean(
      asset &&
        caption.trim() &&
        apiBaseUrl.trim() &&
        clubSlug.trim() &&
        submitterEmail.trim()
    );
  }, [asset, caption, apiBaseUrl, clubSlug, submitterEmail]);

  const canLoadRecent = useMemo(() => {
    return Boolean(apiBaseUrl.trim() && clubSlug.trim() && submitterEmail.trim());
  }, [apiBaseUrl, clubSlug, submitterEmail]);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter((item) => !item.readAt).length;
  }, [notifications]);

  async function loadRecentSubmissions() {
    if (!canLoadRecent) {
      setRecentSubmissions([]);
      return;
    }

    setLoadingRecent(true);

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const query = new URLSearchParams({
        submitterEmail: submitterEmail.trim(),
        clubSlug: clubSlug.trim(),
        limit: "8"
      });

      if (teamSlug.trim()) {
        query.set("teamSlug", teamSlug.trim());
      }

      const response = await fetch(`${baseUrl}/submissions?${query.toString()}`);

      if (!response.ok) {
        throw new Error(`Recent submissions failed: ${response.status}`);
      }

      const payload = await response.json();
      setRecentSubmissions(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      setStatus(error.message || "Could not load recent submissions");
    } finally {
      setLoadingRecent(false);
    }
  }

  async function loadNotifications() {
    if (!canLoadRecent) {
      setNotifications([]);
      return;
    }

    setLoadingNotifications(true);

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const query = new URLSearchParams({
        userEmail: submitterEmail.trim(),
        limit: "8"
      });
      const response = await fetch(`${baseUrl}/notifications?${query.toString()}`);

      if (!response.ok) {
        throw new Error(`Notifications failed: ${response.status}`);
      }

      const payload = await response.json();
      setNotifications(Array.isArray(payload.items) ? payload.items : []);
    } catch (error) {
      setStatus(error.message || "Could not load notifications");
    } finally {
      setLoadingNotifications(false);
    }
  }

  async function loadSubmissionDetail(submissionId) {
    setLoadingDetail(true);

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const response = await fetch(`${baseUrl}/submissions/${submissionId}`);

      if (!response.ok) {
        throw new Error(`Submission detail failed: ${response.status}`);
      }

      const payload = await response.json();
      setSelectedSubmissionDetail(payload);
      setSelectedSubmissionId(submissionId);
    } catch (error) {
      setStatus(error.message || "Could not load submission detail");
      Alert.alert("Detail unavailable", error.message || "Unknown error");
    } finally {
      setLoadingDetail(false);
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const response = await fetch(`${baseUrl}/notifications/${notificationId}/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userEmail: submitterEmail.trim() })
      });

      if (!response.ok) {
        throw new Error(`Mark read failed: ${response.status}`);
      }

      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
    } catch (error) {
      setStatus(error.message || "Could not mark notification read");
    }
  }

  async function refreshDashboard() {
    await Promise.all([loadRecentSubmissions(), loadNotifications()]);
  }

  useEffect(() => {
    if (!canLoadRecent) {
      return;
    }

    refreshDashboard();

    const intervalId = setInterval(() => {
      refreshDashboard();
    }, 20000);

    return () => clearInterval(intervalId);
  }, [canLoadRecent, apiBaseUrl, clubSlug, teamSlug, submitterEmail]);

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
      await refreshDashboard();
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
            disabled={loadingRecent || !canLoadRecent}
            style={[styles.secondaryButton, styles.refreshButton, (!canLoadRecent || loadingRecent) && styles.primaryButtonDisabled]}
            onPress={refreshDashboard}
          >
            <Text style={styles.secondaryButtonText}>
              {loadingRecent || loadingNotifications ? "Refreshing..." : "Refresh Activity"}
            </Text>
          </Pressable>
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

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Submissions</Text>
            {loadingRecent ? <ActivityIndicator color="#17372c" /> : null}
          </View>

          {recentSubmissions.length ? (
            recentSubmissions.map((item) => (
              <Pressable
                key={item.id}
                style={styles.recentItem}
                onPress={() => loadSubmissionDetail(item.id)}
              >
                <View style={styles.recentMetaRow}>
                  <Text style={styles.recentStatus}>{item.status}</Text>
                  <Text style={styles.recentTime}>{formatSubmittedAt(item.created_at)}</Text>
                </View>
                <Text style={styles.recentSummary}>
                  {item.raw_text?.trim() || "No caption provided"}
                </Text>
                <Text style={styles.recentDetail}>
                  {item.content_type} · {item.visibility_target} · {item.media_count} media
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyStateText}>
              No submissions yet for this submitter and team.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Updates</Text>
            <Text style={styles.unreadBadge}>{unreadNotificationCount} unread</Text>
          </View>

          {notifications.length ? (
            notifications.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.notificationItem, !item.readAt && styles.notificationItemUnread]}
                onPress={async () => {
                  if (item.payload?.submissionId) {
                    await loadSubmissionDetail(item.payload.submissionId);
                  }

                  if (!item.readAt) {
                    await markNotificationRead(item.id);
                  }
                }}
              >
                <View style={styles.recentMetaRow}>
                  <Text style={styles.notificationTitle}>{formatNotificationLabel(item.type)}</Text>
                  <Text style={styles.recentTime}>{formatSubmittedAt(item.createdAt)}</Text>
                </View>
                <Text style={styles.notificationBody}>
                  {item.payload?.notes ||
                    item.payload?.summary ||
                    `Submission ${item.payload?.submissionId || ""} moved to ${item.payload?.status || "a new state"}.`}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyStateText}>
              No updates yet. Submission review updates will appear here.
            </Text>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={Boolean(selectedSubmissionId)}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setSelectedSubmissionId(null);
          setSelectedSubmissionDetail(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Submission Detail</Text>
              <Pressable
                onPress={() => {
                  setSelectedSubmissionId(null);
                  setSelectedSubmissionDetail(null);
                }}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>

            {loadingDetail || !selectedSubmissionDetail ? (
              <ActivityIndicator color="#17372c" />
            ) : (
              <ScrollView>
                <Text style={styles.detailStatus}>
                  {selectedSubmissionDetail.status} · {formatSubmittedAt(selectedSubmissionDetail.created_at)}
                </Text>
                <Text style={styles.detailSummary}>
                  {selectedSubmissionDetail.raw_text?.trim() || "No caption provided"}
                </Text>
                <Text style={styles.detailLine}>
                  Visibility: {selectedSubmissionDetail.visibility_target}
                </Text>
                <Text style={styles.detailLine}>
                  Review score: {selectedSubmissionDetail.risk_score || "pending"}
                </Text>
                {selectedSubmissionDetail.latestReviewRun ? (
                  <>
                    <Text style={styles.detailHeading}>Latest Review</Text>
                    <Text style={styles.detailLine}>
                      {selectedSubmissionDetail.latestReviewRun.resultStatus} · {selectedSubmissionDetail.latestReviewRun.agentName}
                    </Text>
                    <Text style={styles.detailBody}>
                      {selectedSubmissionDetail.latestReviewRun.summary}
                    </Text>
                  </>
                ) : null}
                {selectedSubmissionDetail.latestApprovalRequest ? (
                  <>
                    <Text style={styles.detailHeading}>Approval</Text>
                    <Text style={styles.detailLine}>
                      {selectedSubmissionDetail.latestApprovalRequest.state} · {selectedSubmissionDetail.latestApprovalRequest.approverName}
                    </Text>
                    {selectedSubmissionDetail.latestApprovalRequest.latestAction ? (
                      <Text style={styles.detailBody}>
                        Latest action: {selectedSubmissionDetail.latestApprovalRequest.latestAction.action}
                        {selectedSubmissionDetail.latestApprovalRequest.latestAction.notes
                          ? ` — ${selectedSubmissionDetail.latestApprovalRequest.latestAction.notes}`
                          : ""}
                      </Text>
                    ) : null}
                  </>
                ) : null}
                {selectedSubmissionDetail.publishedPost ? (
                  <>
                    <Text style={styles.detailHeading}>Publishing</Text>
                    <Text style={styles.detailLine}>
                      Published to {selectedSubmissionDetail.publishedPost.destinationName}
                    </Text>
                    <Text style={styles.detailBody}>
                      {formatSubmittedAt(selectedSubmissionDetail.publishedPost.publishedAt)}
                    </Text>
                  </>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
  refreshButton: {
    marginBottom: 14
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
  },
  recentItem: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#eadfce"
  },
  recentMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8
  },
  recentStatus: {
    textTransform: "capitalize",
    color: "#17372c",
    fontWeight: "700"
  },
  recentTime: {
    color: "#7b867f",
    fontSize: 12
  },
  recentSummary: {
    color: "#31433b",
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 6
  },
  recentDetail: {
    color: "#7a6b5b",
    fontSize: 13,
    textTransform: "capitalize"
  },
  emptyStateText: {
    color: "#6d7a74",
    fontSize: 15,
    lineHeight: 22
  },
  unreadBadge: {
    color: "#a54b24",
    fontWeight: "700",
    fontSize: 13
  },
  notificationItem: {
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#eadfce"
  },
  notificationItemUnread: {
    backgroundColor: "#fff4e5",
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 12
  },
  notificationTitle: {
    color: "#17372c",
    fontWeight: "700"
  },
  notificationBody: {
    color: "#465650",
    fontSize: 14,
    lineHeight: 21
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(23, 55, 44, 0.45)",
    justifyContent: "flex-end",
    padding: 12
  },
  modalCard: {
    backgroundColor: "#fffaf2",
    borderRadius: 24,
    padding: 20,
    maxHeight: "80%"
  },
  closeButtonText: {
    color: "#a54b24",
    fontWeight: "700"
  },
  detailStatus: {
    color: "#17372c",
    fontWeight: "700",
    marginBottom: 12,
    textTransform: "capitalize"
  },
  detailSummary: {
    color: "#31433b",
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 14
  },
  detailHeading: {
    color: "#17372c",
    fontSize: 15,
    fontWeight: "700",
    marginTop: 12,
    marginBottom: 6
  },
  detailLine: {
    color: "#5d6a65",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 4
  },
  detailBody: {
    color: "#465650",
    fontSize: 14,
    lineHeight: 21
  }
});
