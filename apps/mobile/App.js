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

function formatStatusLabel(value) {
  const normalized = String(value || "submitted").toLowerCase();

  switch (normalized) {
    case "submitted":
      return "Submitted";
    case "needs_human_review":
      return "In Review";
    case "approved":
      return "Approved";
    case "published":
      return "Published";
    case "rejected":
      return "Not Approved";
    case "changes_requested":
      return "Changes Requested";
    default:
      return normalized
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

function getStatusTone(value) {
  const normalized = String(value || "submitted").toLowerCase();

  if (normalized === "published" || normalized === "approved") {
    return "success";
  }

  if (normalized === "rejected" || normalized === "changes_requested") {
    return "attention";
  }

  return "neutral";
}

function formatVisibilityLabel(value) {
  const normalized = String(value || "internal").toLowerCase();

  switch (normalized) {
    case "internal":
      return "Internal only";
    case "public":
      return "Public post";
    default:
      return normalized
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

function formatContentTypeLabel(value) {
  const normalized = String(value || "photo").toLowerCase();
  return normalized === "video" ? "Video" : "Photo";
}

function formatMediaCountLabel(value) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function formatRiskScoreLabel(value) {
  if (value === null || value === undefined || value === "") {
    return "Pending review";
  }

  const score = Number(value);

  if (Number.isNaN(score)) {
    return String(value);
  }

  return `${score.toFixed(2)} risk score`;
}

function summarizeSubmissionProgress(item) {
  const status = String(item?.status || "").toLowerCase();

  if (status === "published") {
    return "Shared successfully.";
  }

  if (status === "approved") {
    return "Approved and ready for publishing.";
  }

  if (status === "rejected") {
    return "Stopped in review.";
  }

  if (status === "changes_requested") {
    return "Needs an update before it can move forward.";
  }

  if (status === "needs_human_review") {
    return "Waiting on reviewer follow-up.";
  }

  return "Captured and waiting for workflow updates.";
}

function buildNotificationBody(item) {
  if (item?.payload?.notes) {
    return item.payload.notes;
  }

  if (item?.payload?.summary) {
    return item.payload.summary;
  }

  if (item?.type === "submission_published") {
    return `Published to ${item.payload?.destinationType || "the club feed"}.`;
  }

  if (item?.type === "submission_review_started") {
    return "Your submission entered the review queue.";
  }

  const subject = item?.payload?.submissionId ? `Submission ${item.payload.submissionId}` : "This submission";
  return `${subject} moved to ${formatStatusLabel(item?.payload?.status || "updated").toLowerCase()}.`;
}

function buildNotificationMeta(item) {
  const meta = [];

  if (item?.payload?.status) {
    meta.push(formatStatusLabel(item.payload.status));
  }

  if (item?.deliveryStatus) {
    meta.push(formatNotificationLabel(item.deliveryStatus));
  } else if (item?.deliveryUpdatedAt) {
    meta.push("Email updated");
  }

  return meta.join(" · ");
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
  const [recentError, setRecentError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
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
    setRecentError("");

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
      setRecentError(error.message || "Could not load recent submissions");
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
    setNotificationsError("");

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
      setNotificationsError(error.message || "Could not load notifications");
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

  const dashboardStatusText = submitting
    ? status
    : canSubmit
      ? "Ready to send this update into the club workflow."
      : "Pick media, add a caption, and confirm your submitter details.";

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
            Capture the update, send it for review, and follow what happens next.
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
              {asset ? `Replace Media: ${asset.name}` : "Choose Photo or Video"}
            </Text>
          </Pressable>
          {asset ? (
            <Text style={styles.helperText}>
              {formatContentTypeLabel(guessContentTypeFromAsset(asset))} selected and ready to upload.
            </Text>
          ) : (
            <Text style={styles.helperText}>
              Add one photo or video for this update.
            </Text>
          )}
          <TextInput
            multiline
            style={[styles.input, styles.textArea]}
            value={caption}
            onChangeText={setCaption}
            placeholder="Write the update parents, coaches, or staff should know"
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
                  {formatVisibilityLabel(value)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.helperText}>
            {visibilityTarget === "public"
              ? "Public posts may need extra review before they are published."
              : "Internal updates stay inside the club workflow unless published later."}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Status</Text>
          <Text style={styles.statusText}>{dashboardStatusText}</Text>
          {!submitting && status !== "Pick media, add a caption, and submit." ? (
            <Text style={styles.statusMetaText}>{status}</Text>
          ) : null}
          <Pressable
            disabled={loadingRecent || !canLoadRecent}
            style={[styles.secondaryButton, styles.refreshButton, (!canLoadRecent || loadingRecent) && styles.primaryButtonDisabled]}
            onPress={refreshDashboard}
          >
            <Text style={styles.secondaryButtonText}>
              {loadingRecent || loadingNotifications ? "Refreshing..." : "Refresh Submissions and Updates"}
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
              <Text style={styles.primaryButtonText}>Send for Review</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Recent Submissions</Text>
            {loadingRecent ? <ActivityIndicator color="#17372c" /> : null}
          </View>
          <Text style={styles.sectionIntro}>
            Your latest uploads and where they stand in the workflow.
          </Text>

          {recentSubmissions.length ? (
            recentSubmissions.map((item) => (
              <Pressable
                key={item.id}
                style={styles.recentItem}
                onPress={() => loadSubmissionDetail(item.id)}
              >
                <View style={styles.recentMetaRow}>
                  <View
                    style={[
                      styles.statusPill,
                      getStatusTone(item.status) === "success" && styles.statusPillSuccess,
                      getStatusTone(item.status) === "attention" && styles.statusPillAttention
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusPillText,
                        getStatusTone(item.status) === "success" && styles.statusPillTextSuccess,
                        getStatusTone(item.status) === "attention" && styles.statusPillTextAttention
                      ]}
                    >
                      {formatStatusLabel(item.status)}
                    </Text>
                  </View>
                  <Text style={styles.recentTime}>{formatSubmittedAt(item.created_at)}</Text>
                </View>
                <Text style={styles.recentSummary}>
                  {item.raw_text?.trim() || "No caption provided"}
                </Text>
                <Text style={styles.recentProgress}>{summarizeSubmissionProgress(item)}</Text>
                <Text style={styles.recentDetail}>
                  {formatContentTypeLabel(item.content_type)} · {formatVisibilityLabel(item.visibility_target)} · {formatMediaCountLabel(item.media_count)}
                </Text>
                <Text style={styles.recentDetail}>
                  {formatRiskScoreLabel(item.risk_score)} · Tap for detail
                </Text>
              </Pressable>
            ))
          ) : loadingRecent ? (
            <Text style={styles.emptyStateText}>Loading recent submissions...</Text>
          ) : recentError ? (
            <Text style={styles.errorStateText}>{recentError}</Text>
          ) : (
            <Text style={styles.emptyStateText}>
              No submissions yet for this submitter and team. Your next upload will appear here.
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>Updates</Text>
            <Text style={styles.unreadBadge}>
              {unreadNotificationCount ? `${unreadNotificationCount} unread` : "All caught up"}
            </Text>
          </View>
          <Text style={styles.sectionIntro}>
            Review, approval, publishing, and delivery updates for your submissions.
          </Text>

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
                  <View style={styles.notificationTitleRow}>
                    {!item.readAt ? <View style={styles.unreadDot} /> : null}
                    <Text style={styles.notificationTitle}>{formatNotificationLabel(item.type)}</Text>
                  </View>
                  <Text style={styles.recentTime}>{formatSubmittedAt(item.createdAt)}</Text>
                </View>
                <Text style={styles.notificationBody}>
                  {buildNotificationBody(item)}
                </Text>
                {buildNotificationMeta(item) ? (
                  <Text style={styles.notificationMeta}>{buildNotificationMeta(item)}</Text>
                ) : null}
              </Pressable>
            ))
          ) : loadingNotifications ? (
            <Text style={styles.emptyStateText}>Loading updates...</Text>
          ) : notificationsError ? (
            <Text style={styles.errorStateText}>{notificationsError}</Text>
          ) : (
            <Text style={styles.emptyStateText}>
              No updates yet. Review and publishing activity will show up here after you submit.
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
                  {formatStatusLabel(selectedSubmissionDetail.status)} · {formatSubmittedAt(selectedSubmissionDetail.created_at)}
                </Text>
                <Text style={styles.detailSummary}>
                  {selectedSubmissionDetail.raw_text?.trim() || "No caption provided"}
                </Text>
                <Text style={styles.detailLine}>
                  {formatContentTypeLabel(selectedSubmissionDetail.content_type)} · {formatMediaCountLabel(selectedSubmissionDetail.media?.length)}
                </Text>
                <Text style={styles.detailLine}>
                  Visibility: {formatVisibilityLabel(selectedSubmissionDetail.visibility_target)}
                </Text>
                <Text style={styles.detailLine}>
                  Review score: {formatRiskScoreLabel(selectedSubmissionDetail.risk_score)}
                </Text>
                <Text style={styles.detailLine}>
                  Club: {selectedSubmissionDetail.club_slug}
                  {selectedSubmissionDetail.team_slug ? ` · Team: ${selectedSubmissionDetail.team_slug}` : ""}
                </Text>
                {selectedSubmissionDetail.latestReviewRun ? (
                  <>
                    <Text style={styles.detailHeading}>Latest Review</Text>
                    <Text style={styles.detailLine}>
                      {formatStatusLabel(selectedSubmissionDetail.latestReviewRun.resultStatus)} · {selectedSubmissionDetail.latestReviewRun.agentName}
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
                      {formatStatusLabel(selectedSubmissionDetail.latestApprovalRequest.state)} · {selectedSubmissionDetail.latestApprovalRequest.approverName}
                    </Text>
                    {selectedSubmissionDetail.latestApprovalRequest.latestAction ? (
                      <Text style={styles.detailBody}>
                        Latest action: {formatStatusLabel(selectedSubmissionDetail.latestApprovalRequest.latestAction.action)}
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
                      {selectedSubmissionDetail.publishedPost.destinationType
                        ? ` · ${formatNotificationLabel(selectedSubmissionDetail.publishedPost.destinationType)}`
                        : ""}
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
  helperText: {
    color: "#6a756f",
    fontSize: 13,
    lineHeight: 19,
    marginTop: -4,
    marginBottom: 12
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
    marginBottom: 6
  },
  statusMetaText: {
    color: "#8a7460",
    fontSize: 13,
    lineHeight: 18,
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
  sectionIntro: {
    color: "#67756f",
    fontSize: 14,
    lineHeight: 20,
    marginTop: -2,
    marginBottom: 4
  },
  recentMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8
  },
  statusPill: {
    backgroundColor: "#edf1ee",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6
  },
  statusPillSuccess: {
    backgroundColor: "#deefe1"
  },
  statusPillAttention: {
    backgroundColor: "#fbe6dc"
  },
  statusPillText: {
    color: "#355047",
    fontWeight: "700"
  },
  statusPillTextSuccess: {
    color: "#1f5a34"
  },
  statusPillTextAttention: {
    color: "#9a4d2d"
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
  recentProgress: {
    color: "#53645d",
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 6
  },
  recentDetail: {
    color: "#7a6b5b",
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 3
  },
  emptyStateText: {
    color: "#6d7a74",
    fontSize: 15,
    lineHeight: 22
  },
  errorStateText: {
    color: "#a54b24",
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
  notificationTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: "#c96a37"
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
  notificationMeta: {
    color: "#8a7460",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 8
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
