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

const progressStages = [
  { key: "submitted", label: "Received" },
  { key: "needs_human_review", label: "Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Published" }
];

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
    case "needs_metadata":
      return "Needs More Detail";
    default:
      return normalized
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

function getStatusTone(value) {
  const normalized = String(value || "submitted").toLowerCase();

  if (["published", "approved"].includes(normalized)) {
    return "success";
  }

  if (["rejected", "changes_requested", "needs_metadata"].includes(normalized)) {
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

  if (score >= 0.75) {
    return "High review concern";
  }

  if (score >= 0.35) {
    return "Moderate review concern";
  }

  return "Low review concern";
}

function summarizeSubmissionProgress(item) {
  const status = String(item?.status || "").toLowerCase();

  if (status === "published") {
    return "Shared successfully.";
  }

  if (status === "approved") {
    return "Approved and queued for publishing.";
  }

  if (status === "rejected") {
    return "Stopped in review.";
  }

  if (status === "changes_requested" || status === "needs_metadata") {
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

  const subject = item?.payload?.submissionId
    ? `Submission ${item.payload.submissionId}`
    : "This submission";

  return `${subject} moved to ${formatStatusLabel(
    item?.payload?.status || "updated"
  ).toLowerCase()}.`;
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

function countStatuses(items) {
  return items.reduce(
    (accumulator, item) => {
      const status = String(item?.status || "submitted").toLowerCase();
      accumulator.total += 1;

      if (status === "published") {
        accumulator.published += 1;
      }

      if (status === "needs_human_review") {
        accumulator.inReview += 1;
      }

      if (["changes_requested", "needs_metadata", "rejected"].includes(status)) {
        accumulator.needsAttention += 1;
      }

      return accumulator;
    },
    { total: 0, published: 0, inReview: 0, needsAttention: 0 }
  );
}

function getProgressStageState(status, stageKey) {
  const normalized = String(status || "submitted").toLowerCase();
  const stageIndex = progressStages.findIndex((item) => item.key === stageKey);
  const currentIndex = progressStages.findIndex((item) => item.key === normalized);

  if (["changes_requested", "needs_metadata", "rejected"].includes(normalized)) {
    if (stageKey === "submitted") {
      return "complete";
    }

    if (stageKey === "needs_human_review") {
      return "current";
    }

    return "pending";
  }

  if (stageIndex === currentIndex) {
    return "current";
  }

  if (stageIndex !== -1 && currentIndex !== -1 && stageIndex < currentIndex) {
    return "complete";
  }

  return "pending";
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

  const submissionStats = useMemo(() => countStatuses(recentSubmissions), [recentSubmissions]);

  const latestSubmission = recentSubmissions[0] || null;

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
      : "Add one asset, write the update, and confirm who is submitting it.";

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
              mediaType:
                guessContentTypeFromAsset(asset) === "video" ? "video" : "image",
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
        <View style={styles.heroPanel}>
          <View style={styles.heroTextBlock}>
            <Text style={styles.kicker}>Creator Dashboard</Text>
            <Text style={styles.title}>Club Content</Text>
            <Text style={styles.subtitle}>
              Send updates into review, track what changed, and see the latest workflow
              activity without digging through admin screens.
            </Text>
          </View>

          <View style={styles.heroStatsRow}>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatLabel}>Submitted</Text>
              <Text style={styles.heroStatValue}>{submissionStats.total}</Text>
            </View>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatLabel}>In Review</Text>
              <Text style={styles.heroStatValue}>{submissionStats.inReview}</Text>
            </View>
            <View style={styles.heroStatCard}>
              <Text style={styles.heroStatLabel}>Published</Text>
              <Text style={styles.heroStatValue}>{submissionStats.published}</Text>
            </View>
          </View>
        </View>

        <View style={styles.panelCard}>
          <View style={styles.panelHeaderRow}>
            <View>
              <Text style={styles.panelEyebrow}>Current draft</Text>
              <Text style={styles.panelTitle}>Create the next update</Text>
            </View>
            <View style={styles.liveBadge}>
              <Text style={styles.liveBadgeText}>
                {submitting ? "Sending" : latestSubmission ? formatStatusLabel(latestSubmission.status) : "Ready"}
              </Text>
            </View>
          </View>

          <Text style={styles.panelBodyText}>{dashboardStatusText}</Text>

          <View style={styles.assetRow}>
            <Pressable style={styles.assetPickerCard} onPress={pickAsset}>
              <Text style={styles.assetPickerLabel}>Media</Text>
              <Text style={styles.assetPickerTitle}>
                {asset ? asset.name : "Choose photo or video"}
              </Text>
              <Text style={styles.assetPickerHint}>
                {asset
                  ? `${formatContentTypeLabel(guessContentTypeFromAsset(asset))} selected and ready.`
                  : "One asset per post keeps review fast."}
              </Text>
            </Pressable>

            <View style={styles.composerMetaCard}>
              <Text style={styles.assetPickerLabel}>Audience</Text>
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
              <Text style={styles.metaHint}>
                {visibilityTarget === "public"
                  ? "Public posts may need extra review before they publish."
                  : "Internal updates stay in the club workflow unless published later."}
              </Text>
            </View>
          </View>

          <TextInput
            multiline
            style={[styles.input, styles.textArea]}
            value={caption}
            onChangeText={setCaption}
            placeholder="Write the update parents, coaches, or staff should know"
          />

          <View style={styles.actionRow}>
            <Pressable
              disabled={loadingRecent || !canLoadRecent}
              style={[
                styles.ghostButton,
                (!canLoadRecent || loadingRecent) && styles.buttonDisabled
              ]}
              onPress={refreshDashboard}
            >
              <Text style={styles.ghostButtonText}>
                {loadingRecent || loadingNotifications ? "Refreshing..." : "Refresh"}
              </Text>
            </Pressable>
            <Pressable
              disabled={!canSubmit || submitting}
              style={[
                styles.primaryButton,
                (!canSubmit || submitting) && styles.buttonDisabled
              ]}
              onPress={submit}
            >
              {submitting ? (
                <ActivityIndicator color="#fdf9f2" />
              ) : (
                <Text style={styles.primaryButtonText}>Send for review</Text>
              )}
            </Pressable>
          </View>

          {!submitting && status !== "Pick media, add a caption, and submit." ? (
            <Text style={styles.statusMetaText}>{status}</Text>
          ) : null}
        </View>

        <View style={styles.panelCard}>
          <View style={styles.panelHeaderRow}>
            <View>
              <Text style={styles.panelEyebrow}>Workflow</Text>
              <Text style={styles.panelTitle}>Your latest status</Text>
            </View>
            <Text style={styles.inlineMetaText}>
              {latestSubmission ? formatSubmittedAt(latestSubmission.created_at) : "Waiting for first post"}
            </Text>
          </View>

          {latestSubmission ? (
            <>
              <View style={styles.latestStatusCard}>
                <View
                  style={[
                    styles.statusPill,
                    getStatusTone(latestSubmission.status) === "success" && styles.statusPillSuccess,
                    getStatusTone(latestSubmission.status) === "attention" && styles.statusPillAttention
                  ]}
                >
                  <Text
                    style={[
                      styles.statusPillText,
                      getStatusTone(latestSubmission.status) === "success" && styles.statusPillTextSuccess,
                      getStatusTone(latestSubmission.status) === "attention" && styles.statusPillTextAttention
                    ]}
                  >
                    {formatStatusLabel(latestSubmission.status)}
                  </Text>
                </View>
                <Text style={styles.latestStatusSummary}>
                  {latestSubmission.raw_text?.trim() || "No caption provided"}
                </Text>
                <Text style={styles.latestStatusBody}>
                  {summarizeSubmissionProgress(latestSubmission)}
                </Text>
              </View>

              <View style={styles.progressTrack}>
                {progressStages.map((stage, index) => {
                  const stageState = getProgressStageState(latestSubmission.status, stage.key);
                  return (
                    <View key={stage.key} style={styles.progressStep}>
                      <View
                        style={[
                          styles.progressDot,
                          stageState === "complete" && styles.progressDotComplete,
                          stageState === "current" && styles.progressDotCurrent
                        ]}
                      >
                        <Text
                          style={[
                            styles.progressDotText,
                            stageState !== "pending" && styles.progressDotTextActive
                          ]}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      <Text
                        style={[
                          styles.progressLabel,
                          stageState !== "pending" && styles.progressLabelActive
                        ]}
                      >
                        {stage.label}
                      </Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.metaChipRow}>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{formatVisibilityLabel(latestSubmission.visibility_target)}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{formatMediaCountLabel(latestSubmission.media_count)}</Text>
                </View>
                <View style={styles.metaChip}>
                  <Text style={styles.metaChipText}>{formatRiskScoreLabel(latestSubmission.risk_score)}</Text>
                </View>
              </View>
            </>
          ) : (
            <Text style={styles.emptyStateText}>
              Your first upload will create a live workflow timeline here.
            </Text>
          )}
        </View>

        <View style={styles.panelCard}>
          <View style={styles.panelHeaderRow}>
            <View>
              <Text style={styles.panelEyebrow}>Recent activity</Text>
              <Text style={styles.panelTitle}>Submissions</Text>
            </View>
            {loadingRecent ? <ActivityIndicator color="#16352f" /> : null}
          </View>
          <Text style={styles.sectionIntro}>
            Open any item for the full review, approval, and publish history.
          </Text>

          {recentSubmissions.length ? (
            recentSubmissions.map((item) => (
              <Pressable key={item.id} style={styles.feedCard} onPress={() => loadSubmissionDetail(item.id)}>
                <View style={styles.feedCardTopRow}>
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
                  <Text style={styles.feedTime}>{formatSubmittedAt(item.created_at)}</Text>
                </View>
                <Text style={styles.feedHeadline}>{item.raw_text?.trim() || "No caption provided"}</Text>
                <Text style={styles.feedSupport}>{summarizeSubmissionProgress(item)}</Text>
                <View style={styles.metaChipRow}>
                  <View style={styles.metaChip}>
                    <Text style={styles.metaChipText}>{formatContentTypeLabel(item.content_type)}</Text>
                  </View>
                  <View style={styles.metaChip}>
                    <Text style={styles.metaChipText}>{formatVisibilityLabel(item.visibility_target)}</Text>
                  </View>
                  <View style={styles.metaChip}>
                    <Text style={styles.metaChipText}>{formatMediaCountLabel(item.media_count)}</Text>
                  </View>
                </View>
              </Pressable>
            ))
          ) : loadingRecent ? (
            <Text style={styles.emptyStateText}>Loading recent submissions...</Text>
          ) : recentError ? (
            <Text style={styles.errorStateText}>{recentError}</Text>
          ) : (
            <Text style={styles.emptyStateText}>
              No submissions yet for this submitter and team.
            </Text>
          )}
        </View>

        <View style={styles.panelCard}>
          <View style={styles.panelHeaderRow}>
            <View>
              <Text style={styles.panelEyebrow}>Notifications</Text>
              <Text style={styles.panelTitle}>Workflow updates</Text>
            </View>
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
                style={[styles.notificationCard, !item.readAt && styles.notificationCardUnread]}
                onPress={async () => {
                  if (item.payload?.submissionId) {
                    await loadSubmissionDetail(item.payload.submissionId);
                  }

                  if (!item.readAt) {
                    await markNotificationRead(item.id);
                  }
                }}
              >
                <View style={styles.feedCardTopRow}>
                  <View style={styles.notificationHeaderRow}>
                    {!item.readAt ? <View style={styles.unreadDot} /> : null}
                    <Text style={styles.notificationTitle}>{formatNotificationLabel(item.type)}</Text>
                  </View>
                  <Text style={styles.feedTime}>{formatSubmittedAt(item.createdAt)}</Text>
                </View>
                <Text style={styles.notificationBody}>{buildNotificationBody(item)}</Text>
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

        <View style={styles.panelCard}>
          <View style={styles.panelHeaderRow}>
            <View>
              <Text style={styles.panelEyebrow}>Connection</Text>
              <Text style={styles.panelTitle}>Submitter settings</Text>
            </View>
            <Text style={styles.inlineMetaText}>Editable in app</Text>
          </View>
          <TextInput
            autoCapitalize="none"
            style={styles.input}
            value={apiBaseUrl}
            onChangeText={setApiBaseUrl}
            placeholder="API base URL"
          />
          <TextInput style={styles.input} value={clubSlug} onChangeText={setClubSlug} placeholder="Club slug" />
          <TextInput style={styles.input} value={teamSlug} onChangeText={setTeamSlug} placeholder="Team slug" />
          <TextInput
            autoCapitalize="none"
            style={[styles.input, styles.inputLast]}
            value={submitterEmail}
            onChangeText={setSubmitterEmail}
            placeholder="Submitter email"
          />
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
            <View style={styles.panelHeaderRow}>
              <View>
                <Text style={styles.panelEyebrow}>Submission detail</Text>
                <Text style={styles.panelTitle}>Workflow timeline</Text>
              </View>
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
              <ActivityIndicator color="#16352f" />
            ) : (
              <ScrollView>
                <View style={styles.modalSummaryCard}>
                  <Text style={styles.detailStatus}>
                    {formatStatusLabel(selectedSubmissionDetail.status)} · {formatSubmittedAt(selectedSubmissionDetail.created_at)}
                  </Text>
                  <Text style={styles.detailSummary}>
                    {selectedSubmissionDetail.raw_text?.trim() || "No caption provided"}
                  </Text>
                  <View style={styles.metaChipRow}>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>
                        {formatContentTypeLabel(selectedSubmissionDetail.content_type)}
                      </Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>
                        {formatMediaCountLabel(selectedSubmissionDetail.media?.length)}
                      </Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>
                        {formatVisibilityLabel(selectedSubmissionDetail.visibility_target)}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.progressTrackDetail}>
                  {progressStages.map((stage, index) => {
                    const stageState = getProgressStageState(selectedSubmissionDetail.status, stage.key);
                    return (
                      <View key={stage.key} style={styles.progressStep}>
                        <View
                          style={[
                            styles.progressDot,
                            stageState === "complete" && styles.progressDotComplete,
                            stageState === "current" && styles.progressDotCurrent
                          ]}
                        >
                          <Text
                            style={[
                              styles.progressDotText,
                              stageState !== "pending" && styles.progressDotTextActive
                            ]}
                          >
                            {index + 1}
                          </Text>
                        </View>
                        <Text
                          style={[
                            styles.progressLabel,
                            stageState !== "pending" && styles.progressLabelActive
                          ]}
                        >
                          {stage.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                <Text style={styles.detailLine}>
                  Review score: {formatRiskScoreLabel(selectedSubmissionDetail.risk_score)}
                </Text>
                <Text style={styles.detailLine}>
                  Club: {selectedSubmissionDetail.club_slug}
                  {selectedSubmissionDetail.team_slug
                    ? ` · Team: ${selectedSubmissionDetail.team_slug}`
                    : ""}
                </Text>
                {selectedSubmissionDetail.latestReviewRun ? (
                  <>
                    <Text style={styles.detailHeading}>Latest review</Text>
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
    backgroundColor: "#f3efe7"
  },
  container: {
    padding: 18,
    paddingBottom: 28,
    gap: 18
  },
  heroPanel: {
    backgroundColor: "#12372d",
    borderRadius: 28,
    padding: 22,
    gap: 18
  },
  heroTextBlock: {
    gap: 8
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    color: "#d9c2a5",
    fontWeight: "700"
  },
  title: {
    fontSize: 34,
    lineHeight: 38,
    color: "#fbf7f0",
    fontWeight: "800"
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: "#d7e1db"
  },
  heroStatsRow: {
    flexDirection: "row",
    gap: 12
  },
  heroStatCard: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 20,
    padding: 14,
    gap: 6
  },
  heroStatLabel: {
    color: "#d0ddd5",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1
  },
  heroStatValue: {
    color: "#fbf7f0",
    fontSize: 24,
    fontWeight: "800"
  },
  panelCard: {
    backgroundColor: "#fcfaf6",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e4ddd2",
    gap: 14,
    shadowColor: "#20352c",
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  },
  panelHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  panelEyebrow: {
    color: "#8b6b4c",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.1
  },
  panelTitle: {
    color: "#17352e",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800",
    marginTop: 2
  },
  panelBodyText: {
    color: "#53625d",
    fontSize: 15,
    lineHeight: 22
  },
  liveBadge: {
    backgroundColor: "#edf3ee",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  liveBadgeText: {
    color: "#1e4b3b",
    fontSize: 12,
    fontWeight: "700"
  },
  assetRow: {
    gap: 12
  },
  assetPickerCard: {
    backgroundColor: "#f6efe6",
    borderRadius: 20,
    padding: 16,
    gap: 6
  },
  composerMetaCard: {
    backgroundColor: "#f6efe6",
    borderRadius: 20,
    padding: 16,
    gap: 10
  },
  assetPickerLabel: {
    color: "#8b6b4c",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    fontWeight: "700"
  },
  assetPickerTitle: {
    color: "#17352e",
    fontSize: 18,
    lineHeight: 24,
    fontWeight: "700"
  },
  assetPickerHint: {
    color: "#6f6960",
    fontSize: 14,
    lineHeight: 20
  },
  metaHint: {
    color: "#6f6960",
    fontSize: 13,
    lineHeight: 19
  },
  input: {
    backgroundColor: "#ffffff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#ddd5c9",
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: "#17352e"
  },
  inputLast: {
    marginBottom: 0
  },
  textArea: {
    minHeight: 120,
    textAlignVertical: "top"
  },
  visibilityRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap"
  },
  visibilityPill: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#e7ddd0"
  },
  visibilityPillActive: {
    backgroundColor: "#17352e"
  },
  visibilityPillText: {
    color: "#76563b",
    fontWeight: "700",
    fontSize: 13
  },
  visibilityPillTextActive: {
    color: "#fcfaf6"
  },
  actionRow: {
    flexDirection: "row",
    gap: 12
  },
  primaryButton: {
    flex: 1,
    minHeight: 54,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#17352e"
  },
  primaryButtonText: {
    color: "#fdf9f2",
    fontSize: 16,
    fontWeight: "800"
  },
  ghostButton: {
    minHeight: 54,
    borderRadius: 18,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#efe7da"
  },
  ghostButtonText: {
    color: "#77553a",
    fontSize: 15,
    fontWeight: "700"
  },
  buttonDisabled: {
    opacity: 0.5
  },
  statusMetaText: {
    color: "#8a7460",
    fontSize: 13,
    lineHeight: 18
  },
  inlineMetaText: {
    color: "#7c807b",
    fontSize: 12,
    fontWeight: "600"
  },
  latestStatusCard: {
    backgroundColor: "#f6efe6",
    borderRadius: 20,
    padding: 16,
    gap: 8
  },
  latestStatusSummary: {
    color: "#17352e",
    fontSize: 17,
    lineHeight: 24,
    fontWeight: "700"
  },
  latestStatusBody: {
    color: "#5a6863",
    fontSize: 14,
    lineHeight: 21
  },
  progressTrack: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8
  },
  progressTrackDetail: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginVertical: 14
  },
  progressStep: {
    flex: 1,
    alignItems: "center",
    gap: 8
  },
  progressDot: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d7d0c5",
    backgroundColor: "#f6f1ea",
    alignItems: "center",
    justifyContent: "center"
  },
  progressDotComplete: {
    backgroundColor: "#dbeedc",
    borderColor: "#91c29c"
  },
  progressDotCurrent: {
    backgroundColor: "#17352e",
    borderColor: "#17352e"
  },
  progressDotText: {
    color: "#8a857b",
    fontWeight: "700"
  },
  progressDotTextActive: {
    color: "#fcfaf6"
  },
  progressLabel: {
    color: "#8a857b",
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center"
  },
  progressLabelActive: {
    color: "#17352e"
  },
  metaChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  metaChip: {
    backgroundColor: "#f1ebdf",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8
  },
  metaChipText: {
    color: "#6b5b49",
    fontSize: 12,
    fontWeight: "700"
  },
  sectionIntro: {
    color: "#61706a",
    fontSize: 14,
    lineHeight: 20,
    marginTop: -4
  },
  feedCard: {
    backgroundColor: "#f7f2eb",
    borderRadius: 20,
    padding: 16,
    gap: 10
  },
  feedCardTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10
  },
  feedTime: {
    color: "#7b817b",
    fontSize: 12,
    flexShrink: 0
  },
  feedHeadline: {
    color: "#17352e",
    fontSize: 16,
    lineHeight: 23,
    fontWeight: "700"
  },
  feedSupport: {
    color: "#5c6964",
    fontSize: 14,
    lineHeight: 20
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
    fontWeight: "700",
    fontSize: 12
  },
  statusPillTextSuccess: {
    color: "#1f5a34"
  },
  statusPillTextAttention: {
    color: "#9a4d2d"
  },
  emptyStateText: {
    color: "#68746f",
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
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.8
  },
  notificationCard: {
    backgroundColor: "#f7f2eb",
    borderRadius: 20,
    padding: 16,
    gap: 8
  },
  notificationCardUnread: {
    backgroundColor: "#fff0dd",
    borderWidth: 1,
    borderColor: "#f0d2ad"
  },
  notificationHeaderRow: {
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
    color: "#17352e",
    fontWeight: "700",
    fontSize: 15,
    flexShrink: 1
  },
  notificationBody: {
    color: "#465650",
    fontSize: 14,
    lineHeight: 21
  },
  notificationMeta: {
    color: "#8a7460",
    fontSize: 12,
    lineHeight: 17
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(16, 40, 33, 0.42)",
    justifyContent: "flex-end",
    padding: 12
  },
  modalCard: {
    backgroundColor: "#fcfaf6",
    borderRadius: 28,
    padding: 20,
    maxHeight: "84%"
  },
  modalSummaryCard: {
    backgroundColor: "#f6efe6",
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
    gap: 10
  },
  closeButtonText: {
    color: "#a54b24",
    fontWeight: "800"
  },
  detailStatus: {
    color: "#17352e",
    fontWeight: "800",
    textTransform: "capitalize"
  },
  detailSummary: {
    color: "#31433b",
    fontSize: 16,
    lineHeight: 24
  },
  detailHeading: {
    color: "#17352e",
    fontSize: 15,
    fontWeight: "800",
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
