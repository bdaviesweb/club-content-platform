import * as FileSystem from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL || "https://clubcontent-api.davmn.net",
  clubSlug: process.env.EXPO_PUBLIC_CLUB_SLUG || "demo-soccer-club",
  teamSlug: process.env.EXPO_PUBLIC_TEAM_SLUG || "u14-girls",
  submitterEmail:
    process.env.EXPO_PUBLIC_SUBMITTER_EMAIL || "clubhqpro@gmail.com"
};

const progressStages = [
  { key: "submitted", label: "Received" },
  { key: "needs_human_review", label: "Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Posted" }
];

function normalizeApiBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function formatSubmittedAt(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
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
      return "Received";
    case "needs_human_review":
      return "In Review";
    case "approved":
      return "Approved";
    case "published":
      return "Posted";
    case "rejected":
      return "Not Approved";
    case "changes_requested":
      return "Needs Changes";
    case "needs_metadata":
      return "Needs Detail";
    default:
      return normalized
        .replaceAll("_", " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
  }
}

function getStatusTone(value) {
  const normalized = String(value || "submitted").toLowerCase();
  if (["published", "approved"].includes(normalized)) return "success";
  if (["rejected", "changes_requested", "needs_metadata"].includes(normalized)) {
    return "attention";
  }
  if (["needs_human_review"].includes(normalized)) return "info";
  return "neutral";
}

function formatVisibilityLabel(value) {
  return String(value || "internal").toLowerCase() === "public"
    ? "Public"
    : "Internal";
}

function formatContentTypeLabel(value) {
  return String(value || "photo").toLowerCase() === "video" ? "Video" : "Photo";
}

function formatMediaCountLabel(value) {
  const count = Number(value || 0);
  return `${count} ${count === 1 ? "file" : "files"}`;
}

function formatRiskScoreLabel(value) {
  if (value === null || value === undefined || value === "") return "Pending review";
  const score = Number(value);
  if (Number.isNaN(score)) return String(value);
  if (score >= 0.75) return "High review concern";
  if (score >= 0.35) return "Moderate review concern";
  return "Low review concern";
}

function summarizeSubmissionProgress(item) {
  const status = String(item?.status || "").toLowerCase();
  if (status === "published") return "Approved and shared to the club feed.";
  if (status === "approved") return "Approved and waiting for publishing.";
  if (status === "rejected") return "Stopped in review.";
  if (status === "changes_requested" || status === "needs_metadata") {
    return "Needs an update before it can move forward.";
  }
  if (status === "needs_human_review") return "A reviewer is looking at it now.";
  return "Captured and waiting to enter review.";
}

function buildNotificationBody(item) {
  if (item?.payload?.notes) return item.payload.notes;
  if (item?.payload?.summary) return item.payload.summary;
  if (item?.type === "submission_published") {
    return `Published to ${item.payload?.destinationType || "the club feed"}.`;
  }
  if (item?.type === "submission_review_started") {
    return "Your update entered the review queue.";
  }
  const subject = item?.payload?.submissionId
    ? `Submission ${item.payload.submissionId}`
    : "This update";
  return `${subject} moved to ${formatStatusLabel(
    item?.payload?.status || "updated"
  ).toLowerCase()}.`;
}

function buildNotificationMeta(item) {
  const meta = [];
  if (item?.payload?.status) meta.push(formatStatusLabel(item.payload.status));
  if (item?.deliveryStatus) meta.push(formatNotificationLabel(item.deliveryStatus));
  return meta.join(" · ");
}

function countStatuses(items) {
  return items.reduce(
    (accumulator, item) => {
      const status = String(item?.status || "submitted").toLowerCase();
      accumulator.total += 1;
      if (status === "published") accumulator.published += 1;
      if (status === "needs_human_review") accumulator.inReview += 1;
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
    if (stageKey === "submitted") return "complete";
    if (stageKey === "needs_human_review") return "current";
    return "pending";
  }
  if (stageIndex === currentIndex) return "current";
  if (stageIndex !== -1 && currentIndex !== -1 && stageIndex < currentIndex) {
    return "complete";
  }
  return "pending";
}

function normalizePickedAsset(asset) {
  if (!asset) return null;
  return {
    ...asset,
    name: asset.fileName || asset.name || `upload-${Date.now()}`,
    mimeType:
      asset.mimeType ||
      (asset.type === "video" ? "video/quicktime" : "image/jpeg")
  };
}

function isVideoAsset(selectedAsset) {
  return (
    selectedAsset?.mimeType?.startsWith("video/") ||
    String(selectedAsset?.type || "").toLowerCase() === "video"
  );
}

function stageTone(stageState) {
  if (stageState === "complete") return "complete";
  if (stageState === "current") return "current";
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
  const [status, setStatus] = useState("Take a photo or choose one to get started.");
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
  const [activeView, setActiveView] = useState("post");
  const [settingsVisible, setSettingsVisible] = useState(false);

  const canSubmit = useMemo(() => {
    return Boolean(
      asset && apiBaseUrl.trim() && clubSlug.trim() && submitterEmail.trim()
    );
  }, [asset, apiBaseUrl, clubSlug, submitterEmail]);

  const canLoadRecent = useMemo(() => {
    return Boolean(apiBaseUrl.trim() && clubSlug.trim() && submitterEmail.trim());
  }, [apiBaseUrl, clubSlug, submitterEmail]);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter((item) => !item.readAt).length;
  }, [notifications]);

  const submissionStats = useMemo(() => countStatuses(recentSubmissions), [recentSubmissions]);
  const latestSubmission = recentSubmissions[0] || null;
  const latestStatusSummary = latestSubmission
    ? summarizeSubmissionProgress(latestSubmission)
    : "Your first post will show review and publish status here.";

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
      if (teamSlug.trim()) query.set("teamSlug", teamSlug.trim());
      const response = await fetch(`${baseUrl}/submissions?${query.toString()}`);
      if (!response.ok) throw new Error(`Recent submissions failed: ${response.status}`);
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
      if (!response.ok) throw new Error(`Notifications failed: ${response.status}`);
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
      if (!response.ok) throw new Error(`Submission detail failed: ${response.status}`);
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
      if (!response.ok) throw new Error(`Mark read failed: ${response.status}`);
      setNotifications((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, readAt: new Date().toISOString() } : item
        )
      );
    } catch (error) {
      setStatus(error.message || "Could not mark notification read");
    }
  }

  async function refreshStatusFeed() {
    await Promise.all([loadRecentSubmissions(), loadNotifications()]);
  }

  useEffect(() => {
    if (!canLoadRecent) return;
    refreshStatusFeed();
    const intervalId = setInterval(() => {
      refreshStatusFeed();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [canLoadRecent, apiBaseUrl, clubSlug, teamSlug, submitterEmail]);

  async function pickFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to choose a post.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.9,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled || !result.assets?.length) return;
    const selected = normalizePickedAsset(result.assets[0]);
    setAsset(selected);
    setStatus(`Ready to submit ${selected.name}`);
    setActiveView("post");
  }

  async function captureWithCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow camera access to capture a club update.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.9,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled || !result.assets?.length) return;
    const selected = normalizePickedAsset(result.assets[0]);
    setAsset(selected);
    setStatus(`Captured ${selected.name}`);
    setActiveView("post");
  }

  function clearDraft() {
    setAsset(null);
    setCaption("");
    setStatus("Take a photo or choose one to get started.");
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
    if (!asset) return;

    setSubmitting(true);
    setStatus("Requesting upload URL...");

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const contentType = isVideoAsset(asset) ? "video" : "photo";

      const signResponse = await fetch(`${baseUrl}/uploads/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubSlug,
          files: [
            {
              filename: asset.name,
              mimeType: asset.mimeType || "application/octet-stream",
              mediaType: contentType === "video" ? "video" : "image"
            }
          ]
        })
      });

      if (!signResponse.ok) {
        throw new Error(`Upload signing failed: ${signResponse.status}`);
      }

      const signPayload = await signResponse.json();
      const uploadPlan = signPayload.uploads?.[0];
      if (!uploadPlan) throw new Error("Upload signing returned no upload plan");

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
          contentType,
          rawText: caption.trim(),
          visibilityTarget,
          media: [
            {
              objectKey: uploadPlan.objectKey,
              mediaType: contentType,
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
      setActiveView("status");
      await refreshStatusFeed();
      Alert.alert("Submitted for review", "Your update is in the club workflow now.");
    } catch (error) {
      setStatus(error.message || "Submission failed");
      Alert.alert("Submission failed", error.message || "Unknown error");
    } finally {
      setSubmitting(false);
    }
  }

  const statusHeadline = asset
    ? "Preview and submit"
    : "Capture the moment";
  const statusSubhead = asset
    ? "Make sure it looks right, add a short caption if you want, then send it in."
    : "Take a quick photo or choose one from your library. Keep it simple and keep it moving.";

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.screen}>
        <View style={styles.topBar}>
          <View>
            <Text style={styles.appName}>Club Content</Text>
            <Text style={styles.appSubtitle}>Post fast. Track clearly.</Text>
          </View>
          <Pressable style={styles.settingsButton} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.settingsButtonText}>Settings</Text>
          </Pressable>
        </View>

        <View style={styles.viewSwitch}>
          <Pressable
            style={[styles.viewSwitchPill, activeView === "post" && styles.viewSwitchPillActive]}
            onPress={() => setActiveView("post")}
          >
            <Text
              style={[styles.viewSwitchText, activeView === "post" && styles.viewSwitchTextActive]}
            >
              Post
            </Text>
          </Pressable>
          <Pressable
            style={[styles.viewSwitchPill, activeView === "status" && styles.viewSwitchPillActive]}
            onPress={() => setActiveView("status")}
          >
            <Text
              style={[styles.viewSwitchText, activeView === "status" && styles.viewSwitchTextActive]}
            >
              Status{unreadNotificationCount ? ` (${unreadNotificationCount})` : ""}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.container}>
          {activeView === "post" ? (
            <>
              {!asset ? (
                <View style={styles.captureCard}>
                  <Text style={styles.captureKicker}>Capture first</Text>
                  <Text style={styles.captureTitle}>{statusHeadline}</Text>
                  <Text style={styles.captureBody}>{statusSubhead}</Text>

                  <View style={styles.captureButtons}>
                    <Pressable style={styles.primaryCaptureButton} onPress={captureWithCamera}>
                      <Text style={styles.primaryCaptureButtonText}>Take photo or video</Text>
                    </Pressable>
                    <Pressable style={styles.secondaryCaptureButton} onPress={pickFromLibrary}>
                      <Text style={styles.secondaryCaptureButtonText}>Choose from library</Text>
                    </Pressable>
                  </View>

                  <View style={styles.captureHintRow}>
                    <Text style={styles.captureHint}>One post at a time.</Text>
                    <Text style={styles.captureHint}>Full review happens after submit.</Text>
                  </View>
                </View>
              ) : (
                <View style={styles.previewCard}>
                  <View style={styles.previewTopRow}>
                    <View>
                      <Text style={styles.captureKicker}>Preview</Text>
                      <Text style={styles.previewTitle}>{formatContentTypeLabel(isVideoAsset(asset) ? "video" : "photo")}</Text>
                    </View>
                    <Pressable style={styles.smallGhostButton} onPress={clearDraft}>
                      <Text style={styles.smallGhostButtonText}>Start over</Text>
                    </Pressable>
                  </View>

                  {isVideoAsset(asset) ? (
                    <View style={styles.videoPlaceholder}>
                      <Text style={styles.videoPlaceholderLabel}>Video selected</Text>
                      <Text style={styles.videoPlaceholderName}>{asset.name}</Text>
                      <Text style={styles.videoPlaceholderHint}>Playback preview can come next. For now, the video is selected and ready.</Text>
                    </View>
                  ) : (
                    <Image source={{ uri: asset.uri }} style={styles.previewImage} resizeMode="cover" />
                  )}

                  <View style={styles.previewMetaRow}>
                    <Text style={styles.previewMeta}>{asset.name}</Text>
                    <Text style={styles.previewMeta}>{formatVisibilityLabel(visibilityTarget)}</Text>
                  </View>

                  <View style={styles.audienceRow}>
                    {[
                      { key: "internal", label: "Internal" },
                      { key: "public", label: "Public" }
                    ].map((option) => (
                      <Pressable
                        key={option.key}
                        style={[
                          styles.audiencePill,
                          visibilityTarget === option.key && styles.audiencePillActive
                        ]}
                        onPress={() => setVisibilityTarget(option.key)}
                      >
                        <Text
                          style={[
                            styles.audiencePillText,
                            visibilityTarget === option.key && styles.audiencePillTextActive
                          ]}
                        >
                          {option.label}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <TextInput
                    multiline
                    style={styles.captionInput}
                    value={caption}
                    onChangeText={setCaption}
                    placeholder="Add a short caption if it helps."
                    placeholderTextColor="#8a8c86"
                  />

                  <View style={styles.submitRow}>
                    <Pressable style={styles.secondaryCaptureButton} onPress={pickFromLibrary}>
                      <Text style={styles.secondaryCaptureButtonText}>Swap media</Text>
                    </Pressable>
                    <Pressable
                      disabled={!canSubmit || submitting}
                      style={[styles.submitButton, (!canSubmit || submitting) && styles.buttonDisabled]}
                      onPress={submit}
                    >
                      {submitting ? (
                        <ActivityIndicator color="#fffdf8" />
                      ) : (
                        <Text style={styles.submitButtonText}>Submit for review</Text>
                      )}
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.statusStripCard}>
                <Text style={styles.statusStripKicker}>Latest status</Text>
                <Text style={styles.statusStripTitle}>
                  {latestSubmission ? formatStatusLabel(latestSubmission.status) : "No posts yet"}
                </Text>
                <Text style={styles.statusStripBody}>{latestStatusSummary}</Text>
                {latestSubmission ? (
                  <Pressable style={styles.inlineLinkButton} onPress={() => setActiveView("status")}>
                    <Text style={styles.inlineLinkButtonText}>Open status feed</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : (
            <>
              <View style={styles.statusHeroCard}>
                <Text style={styles.statusHeroKicker}>Your posts</Text>
                <Text style={styles.statusHeroTitle}>Clear status, no digging.</Text>
                <Text style={styles.statusHeroBody}>
                  Every update moves from received to review to approval to posting. This feed tells you what happened and what needs attention.
                </Text>
                <View style={styles.statusCountRow}>
                  <View style={styles.statusCountPill}>
                    <Text style={styles.statusCountValue}>{submissionStats.inReview}</Text>
                    <Text style={styles.statusCountLabel}>In review</Text>
                  </View>
                  <View style={styles.statusCountPill}>
                    <Text style={styles.statusCountValue}>{submissionStats.needsAttention}</Text>
                    <Text style={styles.statusCountLabel}>Needs attention</Text>
                  </View>
                  <View style={styles.statusCountPill}>
                    <Text style={styles.statusCountValue}>{submissionStats.published}</Text>
                    <Text style={styles.statusCountLabel}>Posted</Text>
                  </View>
                </View>
              </View>

              <View style={styles.feedSection}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Newest post</Text>
                    <Text style={styles.sectionTitle}>Where it stands</Text>
                  </View>
                  <Pressable style={styles.smallGhostButton} onPress={refreshStatusFeed}>
                    <Text style={styles.smallGhostButtonText}>
                      {loadingRecent || loadingNotifications ? "Refreshing" : "Refresh"}
                    </Text>
                  </Pressable>
                </View>

                {latestSubmission ? (
                  <View style={styles.latestPostCard}>
                    <View style={styles.statusBadgeRow}>
                      <View
                        style={[
                          styles.statusBadge,
                          getStatusTone(latestSubmission.status) === "success" && styles.statusBadgeSuccess,
                          getStatusTone(latestSubmission.status) === "attention" && styles.statusBadgeAttention,
                          getStatusTone(latestSubmission.status) === "info" && styles.statusBadgeInfo
                        ]}
                      >
                        <Text
                          style={[
                            styles.statusBadgeText,
                            getStatusTone(latestSubmission.status) === "success" && styles.statusBadgeTextSuccess,
                            getStatusTone(latestSubmission.status) === "attention" && styles.statusBadgeTextAttention,
                            getStatusTone(latestSubmission.status) === "info" && styles.statusBadgeTextInfo
                          ]}
                        >
                          {formatStatusLabel(latestSubmission.status)}
                        </Text>
                      </View>
                      <Text style={styles.feedTime}>{formatSubmittedAt(latestSubmission.created_at)}</Text>
                    </View>

                    <Text style={styles.feedHeadline}>
                      {latestSubmission.raw_text?.trim() || "No caption provided"}
                    </Text>
                    <Text style={styles.feedSupport}>{summarizeSubmissionProgress(latestSubmission)}</Text>

                    <View style={styles.progressTrack}>
                      {progressStages.map((stage, index) => {
                        const state = getProgressStageState(latestSubmission.status, stage.key);
                        return (
                          <View key={stage.key} style={styles.progressStep}>
                            <View
                              style={[
                                styles.progressDot,
                                stageTone(state) === "complete" && styles.progressDotComplete,
                                stageTone(state) === "current" && styles.progressDotCurrent
                              ]}
                            >
                              <Text
                                style={[
                                  styles.progressDotText,
                                  state !== "pending" && styles.progressDotTextActive
                                ]}
                              >
                                {index + 1}
                              </Text>
                            </View>
                            <Text
                              style={[
                                styles.progressLabel,
                                state !== "pending" && styles.progressLabelActive
                              ]}
                            >
                              {stage.label}
                            </Text>
                          </View>
                        );
                      })}
                    </View>

                    <View style={styles.metaChipRow}>
                      <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatVisibilityLabel(latestSubmission.visibility_target)}</Text></View>
                      <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatMediaCountLabel(latestSubmission.media_count)}</Text></View>
                      <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatRiskScoreLabel(latestSubmission.risk_score)}</Text></View>
                    </View>
                  </View>
                ) : loadingRecent ? (
                  <Text style={styles.emptyStateText}>Loading your latest post…</Text>
                ) : recentError ? (
                  <Text style={styles.errorStateText}>{recentError}</Text>
                ) : (
                  <Text style={styles.emptyStateText}>When you submit a photo or video, the review timeline will show here.</Text>
                )}
              </View>

              <View style={styles.feedSection}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Recent posts</Text>
                    <Text style={styles.sectionTitle}>Submission history</Text>
                  </View>
                </View>

                {recentSubmissions.length ? (
                  recentSubmissions.map((item) => (
                    <Pressable key={item.id} style={styles.feedCard} onPress={() => loadSubmissionDetail(item.id)}>
                      <View style={styles.statusBadgeRow}>
                        <View
                          style={[
                            styles.statusBadge,
                            getStatusTone(item.status) === "success" && styles.statusBadgeSuccess,
                            getStatusTone(item.status) === "attention" && styles.statusBadgeAttention,
                            getStatusTone(item.status) === "info" && styles.statusBadgeInfo
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              getStatusTone(item.status) === "success" && styles.statusBadgeTextSuccess,
                              getStatusTone(item.status) === "attention" && styles.statusBadgeTextAttention,
                              getStatusTone(item.status) === "info" && styles.statusBadgeTextInfo
                            ]}
                          >
                            {formatStatusLabel(item.status)}
                          </Text>
                        </View>
                        <Text style={styles.feedTime}>{formatSubmittedAt(item.created_at)}</Text>
                      </View>
                      <Text style={styles.feedHeadline}>{item.raw_text?.trim() || "No caption provided"}</Text>
                      <Text style={styles.feedSupport}>{summarizeSubmissionProgress(item)}</Text>
                    </Pressable>
                  ))
                ) : loadingRecent ? (
                  <Text style={styles.emptyStateText}>Loading recent posts…</Text>
                ) : recentError ? (
                  <Text style={styles.errorStateText}>{recentError}</Text>
                ) : (
                  <Text style={styles.emptyStateText}>No posts yet for this account.</Text>
                )}
              </View>

              <View style={styles.feedSection}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Updates</Text>
                    <Text style={styles.sectionTitle}>Notifications</Text>
                  </View>
                  <Text style={styles.unreadBadge}>
                    {unreadNotificationCount ? `${unreadNotificationCount} unread` : "All caught up"}
                  </Text>
                </View>

                {notifications.length ? (
                  notifications.map((item) => (
                    <Pressable
                      key={item.id}
                      style={[styles.notificationCard, !item.readAt && styles.notificationCardUnread]}
                      onPress={async () => {
                        if (item.payload?.submissionId) await loadSubmissionDetail(item.payload.submissionId);
                        if (!item.readAt) await markNotificationRead(item.id);
                      }}
                    >
                      <View style={styles.notificationHeaderRow}>
                        <View style={styles.notificationHeaderLeft}>
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
                  <Text style={styles.emptyStateText}>Loading updates…</Text>
                ) : notificationsError ? (
                  <Text style={styles.errorStateText}>{notificationsError}</Text>
                ) : (
                  <Text style={styles.emptyStateText}>Review, approval, and publishing updates will show here.</Text>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </View>

      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionKicker}>Settings</Text>
                <Text style={styles.sectionTitle}>Submitter connection</Text>
              </View>
              <Pressable onPress={() => setSettingsVisible(false)}>
                <Text style={styles.closeButtonText}>Done</Text>
              </Pressable>
            </View>
            <TextInput autoCapitalize="none" style={styles.input} value={apiBaseUrl} onChangeText={setApiBaseUrl} placeholder="API base URL" />
            <TextInput style={styles.input} value={clubSlug} onChangeText={setClubSlug} placeholder="Club slug" />
            <TextInput style={styles.input} value={teamSlug} onChangeText={setTeamSlug} placeholder="Team slug" />
            <TextInput autoCapitalize="none" style={[styles.input, styles.inputLast]} value={submitterEmail} onChangeText={setSubmitterEmail} placeholder="Submitter email" />
          </View>
        </View>
      </Modal>

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
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionKicker}>Submission detail</Text>
                <Text style={styles.sectionTitle}>Full status</Text>
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
              <ActivityIndicator color="#12372d" />
            ) : (
              <ScrollView>
                <View style={styles.detailHero}>
                  <Text style={styles.detailStatus}>{formatStatusLabel(selectedSubmissionDetail.status)}</Text>
                  <Text style={styles.detailSummary}>{selectedSubmissionDetail.raw_text?.trim() || "No caption provided"}</Text>
                  <Text style={styles.detailMeta}>{formatSubmittedAt(selectedSubmissionDetail.created_at)}</Text>
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
                        <Text style={[styles.progressLabel, stageState !== "pending" && styles.progressLabelActive]}>
                          {stage.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                <View style={styles.metaChipRow}>
                  <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatContentTypeLabel(selectedSubmissionDetail.content_type)}</Text></View>
                  <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatMediaCountLabel(selectedSubmissionDetail.media?.length)}</Text></View>
                  <View style={styles.metaChip}><Text style={styles.metaChipText}>{formatVisibilityLabel(selectedSubmissionDetail.visibility_target)}</Text></View>
                </View>

                <Text style={styles.detailLine}>Review score: {formatRiskScoreLabel(selectedSubmissionDetail.risk_score)}</Text>
                <Text style={styles.detailLine}>
                  Club: {selectedSubmissionDetail.club_slug}
                  {selectedSubmissionDetail.team_slug ? ` · Team: ${selectedSubmissionDetail.team_slug}` : ""}
                </Text>

                {selectedSubmissionDetail.latestReviewRun ? (
                  <>
                    <Text style={styles.detailHeading}>Latest review</Text>
                    <Text style={styles.detailBody}>
                      {formatStatusLabel(selectedSubmissionDetail.latestReviewRun.resultStatus)} · {selectedSubmissionDetail.latestReviewRun.agentName}
                    </Text>
                    <Text style={styles.detailBody}>{selectedSubmissionDetail.latestReviewRun.summary}</Text>
                  </>
                ) : null}

                {selectedSubmissionDetail.latestApprovalRequest ? (
                  <>
                    <Text style={styles.detailHeading}>Approval</Text>
                    <Text style={styles.detailBody}>
                      {formatStatusLabel(selectedSubmissionDetail.latestApprovalRequest.state)} · {selectedSubmissionDetail.latestApprovalRequest.approverName}
                    </Text>
                    {selectedSubmissionDetail.latestApprovalRequest.latestAction ? (
                      <Text style={styles.detailBody}>
                        Latest action: {formatStatusLabel(selectedSubmissionDetail.latestApprovalRequest.latestAction.action)}
                        {selectedSubmissionDetail.latestApprovalRequest.latestAction.notes ? ` — ${selectedSubmissionDetail.latestApprovalRequest.latestAction.notes}` : ""}
                      </Text>
                    ) : null}
                  </>
                ) : null}

                {selectedSubmissionDetail.publishedPost ? (
                  <>
                    <Text style={styles.detailHeading}>Publishing</Text>
                    <Text style={styles.detailBody}>Published to {selectedSubmissionDetail.publishedPost.destinationName}</Text>
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
    backgroundColor: "#f6f1e8"
  },
  screen: {
    flex: 1
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 10
  },
  appName: {
    fontSize: 24,
    lineHeight: 28,
    color: "#10261e",
    fontWeight: "800"
  },
  appSubtitle: {
    fontSize: 13,
    color: "#68766f"
  },
  settingsButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(16,38,30,0.06)"
  },
  settingsButtonText: {
    color: "#10261e",
    fontWeight: "700"
  },
  viewSwitch: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10
  },
  viewSwitchPill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.68)"
  },
  viewSwitchPillActive: {
    backgroundColor: "#12372d"
  },
  viewSwitchText: {
    color: "#12372d",
    fontWeight: "700"
  },
  viewSwitchTextActive: {
    color: "#fdf8f0"
  },
  container: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 18
  },
  captureCard: {
    backgroundColor: "#12372d",
    borderRadius: 30,
    padding: 22,
    gap: 18
  },
  captureKicker: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#d9c2a5",
    fontWeight: "700"
  },
  captureTitle: {
    fontSize: 36,
    lineHeight: 38,
    color: "#fbf7f0",
    fontWeight: "800"
  },
  captureBody: {
    fontSize: 16,
    lineHeight: 24,
    color: "#d6e0db"
  },
  captureButtons: {
    gap: 12
  },
  primaryCaptureButton: {
    backgroundColor: "#f9f3ea",
    borderRadius: 22,
    paddingVertical: 18,
    alignItems: "center"
  },
  primaryCaptureButtonText: {
    color: "#10261e",
    fontSize: 17,
    fontWeight: "800"
  },
  secondaryCaptureButton: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 22,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center"
  },
  secondaryCaptureButtonText: {
    color: "#f8f3eb",
    fontWeight: "700"
  },
  captureHintRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  captureHint: {
    color: "#d1dbd6",
    fontSize: 13
  },
  previewCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 30,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: "#e1d3bd"
  },
  previewTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center"
  },
  previewTitle: {
    fontSize: 28,
    lineHeight: 30,
    color: "#10261e",
    fontWeight: "800"
  },
  smallGhostButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(16,38,30,0.06)"
  },
  smallGhostButtonText: {
    color: "#12372d",
    fontWeight: "700"
  },
  previewImage: {
    width: "100%",
    height: 430,
    borderRadius: 26,
    backgroundColor: "#d5ddd8"
  },
  videoPlaceholder: {
    minHeight: 320,
    borderRadius: 26,
    backgroundColor: "#18382f",
    padding: 22,
    justifyContent: "center",
    gap: 10
  },
  videoPlaceholderLabel: {
    color: "#d8c2a7",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    fontWeight: "700",
    fontSize: 12
  },
  videoPlaceholderName: {
    color: "#fbf7f0",
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800"
  },
  videoPlaceholderHint: {
    color: "#d1dbd6",
    lineHeight: 22
  },
  previewMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12
  },
  previewMeta: {
    color: "#6c756f",
    fontSize: 13,
    flex: 1
  },
  audienceRow: {
    flexDirection: "row",
    gap: 10
  },
  audiencePill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#f0e6d8"
  },
  audiencePillActive: {
    backgroundColor: "#12372d"
  },
  audiencePillText: {
    color: "#6e5940",
    fontWeight: "700"
  },
  audiencePillTextActive: {
    color: "#fff8ee"
  },
  captionInput: {
    minHeight: 110,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e1d3bd",
    color: "#10261e",
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 22
  },
  submitRow: {
    flexDirection: "row",
    gap: 10
  },
  submitButton: {
    flex: 1,
    borderRadius: 22,
    backgroundColor: "#12372d",
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  submitButtonText: {
    color: "#fffaf4",
    fontSize: 16,
    fontWeight: "800"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  statusStripCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e1d3bd",
    gap: 8
  },
  statusStripKicker: {
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#8d7659",
    fontWeight: "700"
  },
  statusStripTitle: {
    fontSize: 22,
    lineHeight: 25,
    color: "#10261e",
    fontWeight: "800"
  },
  statusStripBody: {
    color: "#5f6862",
    lineHeight: 21
  },
  inlineLinkButton: {
    alignSelf: "flex-start",
    marginTop: 4
  },
  inlineLinkButtonText: {
    color: "#176744",
    fontWeight: "800"
  },
  statusHeroCard: {
    backgroundColor: "#12372d",
    borderRadius: 28,
    padding: 20,
    gap: 12
  },
  statusHeroKicker: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#d9c2a5",
    fontWeight: "700"
  },
  statusHeroTitle: {
    fontSize: 30,
    lineHeight: 33,
    color: "#fdf8ef",
    fontWeight: "800"
  },
  statusHeroBody: {
    color: "#d6e0db",
    lineHeight: 22
  },
  statusCountRow: {
    flexDirection: "row",
    gap: 10
  },
  statusCountPill: {
    flex: 1,
    borderRadius: 20,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center"
  },
  statusCountValue: {
    color: "#fff8ef",
    fontSize: 24,
    fontWeight: "800"
  },
  statusCountLabel: {
    color: "#d5dfda",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: 4
  },
  feedSection: {
    gap: 12
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12
  },
  sectionKicker: {
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#8d7659",
    fontWeight: "700"
  },
  sectionTitle: {
    fontSize: 26,
    lineHeight: 28,
    color: "#10261e",
    fontWeight: "800"
  },
  unreadBadge: {
    color: "#176744",
    fontWeight: "800"
  },
  latestPostCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: "#e1d3bd",
    gap: 12
  },
  statusBadgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center"
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(102,117,109,0.12)"
  },
  statusBadgeSuccess: {
    backgroundColor: "#dff0e7"
  },
  statusBadgeAttention: {
    backgroundColor: "#f6dfdc"
  },
  statusBadgeInfo: {
    backgroundColor: "#dce9f1"
  },
  statusBadgeText: {
    color: "#67766d",
    fontWeight: "800",
    fontSize: 12
  },
  statusBadgeTextSuccess: { color: "#176744" },
  statusBadgeTextAttention: { color: "#8b342e" },
  statusBadgeTextInfo: { color: "#305e7a" },
  feedTime: {
    color: "#7a7f7a",
    fontSize: 12,
    flexShrink: 1,
    textAlign: "right"
  },
  feedHeadline: {
    fontSize: 20,
    lineHeight: 24,
    color: "#10261e",
    fontWeight: "800"
  },
  feedSupport: {
    color: "#5f6862",
    lineHeight: 21
  },
  progressTrack: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginTop: 2
  },
  progressTrackDetail: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    marginVertical: 14
  },
  progressStep: {
    alignItems: "center",
    gap: 6,
    flex: 1
  },
  progressDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#ece5d7",
    alignItems: "center",
    justifyContent: "center"
  },
  progressDotComplete: {
    backgroundColor: "#176744"
  },
  progressDotCurrent: {
    backgroundColor: "#c38a45"
  },
  progressDotText: {
    color: "#84755f",
    fontWeight: "800",
    fontSize: 12
  },
  progressDotTextActive: {
    color: "#fff9ef"
  },
  progressLabel: {
    color: "#8a847b",
    fontSize: 11,
    fontWeight: "700"
  },
  progressLabelActive: {
    color: "#10261e"
  },
  metaChipRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  metaChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#f1e8da"
  },
  metaChipText: {
    color: "#6d604f",
    fontWeight: "700",
    fontSize: 12
  },
  feedCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e1d3bd",
    gap: 10
  },
  notificationCard: {
    backgroundColor: "#fffaf3",
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e1d3bd",
    gap: 10
  },
  notificationCardUnread: {
    borderColor: "#176744",
    backgroundColor: "#f4fbf7"
  },
  notificationHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8,
    alignItems: "center"
  },
  notificationHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#176744"
  },
  notificationTitle: {
    color: "#10261e",
    fontWeight: "800",
    flexShrink: 1
  },
  notificationBody: {
    color: "#49534d",
    lineHeight: 21
  },
  notificationMeta: {
    color: "#7a7f7a",
    fontSize: 12
  },
  emptyStateText: {
    color: "#6b736d",
    lineHeight: 21
  },
  errorStateText: {
    color: "#8b342e",
    lineHeight: 21
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10,24,19,0.42)",
    justifyContent: "flex-end"
  },
  modalCard: {
    maxHeight: "88%",
    backgroundColor: "#fffaf3",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 20,
    gap: 12
  },
  closeButtonText: {
    color: "#176744",
    fontWeight: "800",
    fontSize: 16
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#e1d3bd",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#10261e"
  },
  inputLast: {
    marginBottom: 4
  },
  detailHero: {
    backgroundColor: "#f1e8da",
    borderRadius: 20,
    padding: 16,
    gap: 8
  },
  detailStatus: {
    color: "#176744",
    fontWeight: "800"
  },
  detailSummary: {
    color: "#10261e",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800"
  },
  detailMeta: {
    color: "#6d6f6d"
  },
  detailHeading: {
    marginTop: 16,
    marginBottom: 6,
    color: "#10261e",
    fontWeight: "800",
    fontSize: 16
  },
  detailLine: {
    color: "#5c6560",
    marginTop: 10,
    lineHeight: 21
  },
  detailBody: {
    color: "#4d5651",
    lineHeight: 21,
    marginTop: 6
  }
});
