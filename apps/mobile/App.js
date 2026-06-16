import Constants from "expo-constants";
import { File as ExpoFile } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";

const { registerPushToken } = require("./pushRegistration");
const { buildMobileRolePolicy, submitterMode } = require("./rolePolicy");
const {
  getClubFeedImagePreviewUrls,
  getPrimaryClubFeedImagePreviewMedia
} = require("./feedMedia");
const { uploadSelectedAsset } = require("./mediaUpload");
const { buildApiError } = require("./apiErrors");
const {
  extractReadinessDefaults,
  fetchAppReadiness,
  formatCapability,
  shouldApplyReadinessDefault,
  summarizeAppReadiness
} = require("./appReadiness");
const {
  formatLastUpdatedLabel,
  getRefreshButtonLabel
} = require("./refreshFeedback");
const {
  countStatuses,
  formatApprovalRoleLabel,
  formatStatusLabel,
  formatRoutingSourceLabel,
  getProgressStageState,
  getStatusTone,
  progressStages,
  summarizeSubmissionProgress
} = require("./statusHelpers");

const defaultConfig = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL || "https://clubcontent-api.davmn.net",
  clubSlug: process.env.EXPO_PUBLIC_CLUB_SLUG || "demo-soccer-club",
  teamSlug: process.env.EXPO_PUBLIC_TEAM_SLUG || "u14-girls",
  submitterEmail:
    process.env.EXPO_PUBLIC_SUBMITTER_EMAIL || "coach@demo-club.local",
  reviewerEmail:
    process.env.EXPO_PUBLIC_REVIEWER_EMAIL || "comms@demo-club.local",
  roleMode: process.env.EXPO_PUBLIC_MOBILE_ROLE || submitterMode
};

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

function buildPublishedShareMessage(submission) {
  const caption =
    submission?.caption_draft?.trim() ||
    submission?.raw_text?.trim() ||
    "Club update";
  const destination = submission?.publishedPost?.destinationName || "the club feed";
  const publishedAt = submission?.publishedPost?.publishedAt
    ? formatSubmittedAt(submission.publishedPost.publishedAt)
    : null;
  const mediaUrl = submission?.media?.find((item) => item.previewUrl)?.previewUrl;
  const lines = [caption, "", `Published to ${destination}.`];

  if (publishedAt) lines.push(`Published ${publishedAt}.`);
  if (mediaUrl) lines.push(mediaUrl);

  return lines.join("\n");
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function prefetchWithTimeout(uri, timeoutMilliseconds = 2500) {
  if (!uri) return false;

  return Promise.race([
    Image.prefetch(uri),
    wait(timeoutMilliseconds).then(() => false)
  ]);
}

function fixPromptForReasonCode(reasonCode) {
  switch (String(reasonCode || "").toLowerCase()) {
    case "score_details":
      return {
        title: "Add the score details",
        body: "This one mostly needs the missing game detail. Add the score, opponent, or event context, then send it back in."
      };
    case "caption_detail":
      return {
        title: "Add one missing detail",
        body: "The photo is probably fine. Tighten the caption with one more useful detail so families understand the moment."
      };
    case "caption_tighten":
      return {
        title: "Tighten the caption",
        body: "Keep it short and club-ready. A cleaner caption should be enough here."
      };
    case "missing_context":
      return {
        title: "Add more context",
        body: "This needs a little more who/what/when so it makes sense once it is posted."
      };
    case "privacy_safe_retake":
      return {
        title: "Replace the photo",
        body: "This one likely needs a safer or cleaner image. Retake or swap the media before you resubmit."
      };
    case "club_guidelines":
      return {
        title: "This post does not fit yet",
        body: "Use the reviewer note to decide whether a rewrite or a replacement image gives this a better chance on the next pass."
      };
    case "admin_review_required":
      return {
        title: "Needs admin follow-up",
        body: "This should probably not be resubmitted without a stronger change. Use the reviewer note carefully before sending it back in."
      };
    default:
      return {
        title: "Fix and resend",
        body: "Add the missing detail, then send this back into review."
      };
  }
}

function resubmitShortcutsForReasonCode(reasonCode) {
  switch (String(reasonCode || "").toLowerCase()) {
    case "score_details":
      return [
        { label: "Add score", text: "Final score: " },
        { label: "Add opponent", text: "Opponent: " },
        { label: "Add scorer", text: "Scorers: " }
      ];
    case "caption_detail":
      return [
        { label: "Add event", text: "Event: " },
        { label: "Add who", text: "Players involved: " },
        { label: "Add when", text: "Happened during: " }
      ];
    case "caption_tighten":
      return [
        { label: "Shorten it", text: "Quick version: " },
        { label: "Club tone", text: "Team update: " }
      ];
    case "missing_context":
      return [
        { label: "Add who", text: "Who: " },
        { label: "Add what", text: "What happened: " },
        { label: "Add when", text: "When: " }
      ];
    case "privacy_safe_retake":
      return [
        { label: "Retake media", mediaAction: "camera" },
        { label: "Choose another", mediaAction: "library" }
      ];
    case "club_guidelines":
      return [
        { label: "Rewrite caption", text: "Rewritten caption: " },
        { label: "Choose new media", mediaAction: "library" }
      ];
    default:
      return [];
  }
}

const reviewReasonSets = {
  request_changes: [
    {
      code: "missing_context",
      label: "More context",
      helper: "Ask for who, what, or when.",
      text: "Please add more context so families know what happened."
    },
    {
      code: "caption_detail",
      label: "One more detail",
      helper: "Ask for one clear missing point.",
      text: "Looks good, but the caption needs one clear detail added."
    },
    {
      code: "score_details",
      label: "Score details",
      helper: "Ask for the score, opponent, or event.",
      text: "Please confirm the event, opponent, or score before we post this."
    },
    {
      code: "caption_tighten",
      label: "Tighten caption",
      helper: "Ask for a cleaner club-ready caption.",
      text: "Please tighten the caption so it is club-ready."
    }
  ],
  reject: [
    {
      code: "club_guidelines",
      label: "Off guidelines",
      helper: "Use when the post does not fit club standards.",
      text: "This does not fit club posting guidelines."
    },
    {
      code: "privacy_safe_retake",
      label: "Safer retake",
      helper: "Use when the media needs a privacy-safe replacement.",
      text: "We cannot publish this without a clearer privacy-safe version."
    },
    {
      code: "stop_current_form",
      label: "Stop this version",
      helper: "Use when this exact post should not move forward.",
      text: "This should not move forward in its current form."
    },
    {
      code: "admin_review_required",
      label: "Admin follow-up",
      helper: "Use when this needs a stronger admin conversation.",
      text: "Please do not repost this item without admin review."
    }
  ]
};

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

function GlassLayer() {
  return <View pointerEvents="none" style={styles.glassFillSoft} />;
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultConfig.apiBaseUrl);
  const [clubSlug, setClubSlug] = useState(defaultConfig.clubSlug);
  const [teamSlug, setTeamSlug] = useState(defaultConfig.teamSlug);
  const [submitterEmail, setSubmitterEmail] = useState(defaultConfig.submitterEmail);
  const [reviewerEmail, setReviewerEmail] = useState(defaultConfig.reviewerEmail);
  const [roleMode, setRoleMode] = useState(defaultConfig.roleMode);
  const [caption, setCaption] = useState("");
  const [visibilityTarget, setVisibilityTarget] = useState("internal");
  const [asset, setAsset] = useState(null);
  const [status, setStatus] = useState("Take a photo or choose one to get started.");
  const [submitting, setSubmitting] = useState(false);
  const [recentSubmissions, setRecentSubmissions] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentError, setRecentError] = useState("");
  const [clubFeedItems, setClubFeedItems] = useState([]);
  const [loadingClubFeed, setLoadingClubFeed] = useState(false);
  const [clubFeedError, setClubFeedError] = useState("");
  const [failedClubFeedImages, setFailedClubFeedImages] = useState({});
  const [refreshingView, setRefreshingView] = useState(false);
  const [clubFeedLastRefreshedAt, setClubFeedLastRefreshedAt] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [pushRegistrationStatus, setPushRegistrationStatus] = useState("");
  const [selectedSubmissionId, setSelectedSubmissionId] = useState(null);
  const [selectedSubmissionDetail, setSelectedSubmissionDetail] = useState(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [resubmissionText, setResubmissionText] = useState("");
  const [resubmissionAsset, setResubmissionAsset] = useState(null);
  const [resubmittingDetail, setResubmittingDetail] = useState(false);
  const [activeView, setActiveView] = useState("post");
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [reviewQueue, setReviewQueue] = useState([]);
  const [loadingReviewQueue, setLoadingReviewQueue] = useState(false);
  const [reviewQueueError, setReviewQueueError] = useState("");
  const [reviewAction, setReviewAction] = useState("approve");
  const [reviewActionReasonCode, setReviewActionReasonCode] = useState(null);
  const [reviewActionNotes, setReviewActionNotes] = useState("");
  const [reviewActionEditorVisible, setReviewActionEditorVisible] = useState(false);
  const [reviewActionInProgress, setReviewActionInProgress] = useState(false);
  const [reviewActionStatus, setReviewActionStatus] = useState("Pick a review item to get started.");
  const [lastReviewedPublishedSubmission, setLastReviewedPublishedSubmission] = useState(null);
  const [appReadiness, setAppReadiness] = useState(null);
  const [loadingAppReadiness, setLoadingAppReadiness] = useState(false);
  const [appReadinessError, setAppReadinessError] = useState("");

  const roleAccess = useMemo(
    () =>
      buildMobileRolePolicy({
        mode: roleMode,
        submitterEmail,
        reviewerEmail
      }),
    [roleMode, submitterEmail, reviewerEmail]
  );

  const canSubmit = useMemo(() => {
    return Boolean(asset && apiBaseUrl.trim() && clubSlug.trim() && roleAccess.canSubmit);
  }, [asset, apiBaseUrl, clubSlug, roleAccess.canSubmit]);

  const canLoadRecent = useMemo(() => {
    return Boolean(apiBaseUrl.trim() && clubSlug.trim() && roleAccess.canTrackSubmissions);
  }, [apiBaseUrl, clubSlug, roleAccess.canTrackSubmissions]);

  const canLoadClubFeed = useMemo(() => {
    return Boolean(apiBaseUrl.trim());
  }, [apiBaseUrl]);

  const canReview = useMemo(() => {
    return Boolean(apiBaseUrl.trim() && roleAccess.canReview);
  }, [apiBaseUrl, roleAccess.canReview]);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter((item) => !item.readAt).length;
  }, [notifications]);

  const submissionStats = useMemo(() => countStatuses(recentSubmissions), [recentSubmissions]);
  const latestSubmission = recentSubmissions[0] || null;
  const appBuildInfo = useMemo(() => {
    const expoConfig = Constants.expoConfig || {};
    const easProjectId = expoConfig.extra?.eas?.projectId || "not configured";
    return {
      appName: expoConfig.name || "Club Content",
      appVersion: Constants.nativeAppVersion || expoConfig.version || "0.1.0",
      buildNumber: Constants.nativeBuildVersion || "development",
      bundleIdentifier: expoConfig.ios?.bundleIdentifier || "com.hermes.clubcontent",
      easProjectId,
      executionEnvironment: Constants.executionEnvironment || "unknown"
    };
  }, []);
  const appReadinessSummary = useMemo(() => summarizeAppReadiness(appReadiness), [appReadiness]);
  const readinessCapabilities = appReadiness?.capabilities || {};
  const latestStatusSummary = latestSubmission
    ? summarizeSubmissionProgress(latestSubmission)
    : "Your first post will show review and publish status here.";
  const resubmitPrompt = useMemo(() => {
    return fixPromptForReasonCode(
      selectedSubmissionDetail?.latestApprovalRequest?.latestAction?.reasonCode
    );
  }, [selectedSubmissionDetail]);

  useEffect(() => {
    if (!apiBaseUrl.trim()) return;

    let isCurrent = true;

    async function loadReadiness() {
      setLoadingAppReadiness(true);
      try {
        const payload = await fetchAppReadiness(apiBaseUrl);
        if (!isCurrent) return;

        const defaults = extractReadinessDefaults(payload);
        setAppReadiness(payload);
        setAppReadinessError("");

        if (defaults.clubSlug) {
          setClubSlug((current) =>
            shouldApplyReadinessDefault(current, defaultConfig.clubSlug) ? defaults.clubSlug : current
          );
        }
        if (defaults.teamSlug) {
          setTeamSlug((current) =>
            shouldApplyReadinessDefault(current, defaultConfig.teamSlug) ? defaults.teamSlug : current
          );
        }
        if (defaults.submitterEmail) {
          setSubmitterEmail((current) =>
            shouldApplyReadinessDefault(current, defaultConfig.submitterEmail) ? defaults.submitterEmail : current
          );
        }
        if (defaults.reviewerEmail) {
          setReviewerEmail((current) =>
            shouldApplyReadinessDefault(current, defaultConfig.reviewerEmail) ? defaults.reviewerEmail : current
          );
        }
      } catch (error) {
        if (!isCurrent) return;
        setAppReadiness(null);
        setAppReadinessError(error.message || "Could not load backend rules");
      } finally {
        if (isCurrent) setLoadingAppReadiness(false);
      }
    }

    loadReadiness();

    return () => {
      isCurrent = false;
    };
  }, [apiBaseUrl]);
  const resubmitShortcuts = useMemo(() => {
    return resubmitShortcutsForReasonCode(
      selectedSubmissionDetail?.latestApprovalRequest?.latestAction?.reasonCode
    );
  }, [selectedSubmissionDetail]);

  useEffect(() => {
    if (activeView !== "review" || roleAccess.showReviewTools) return;
    setActiveView("post");
    setSelectedSubmissionId(null);
    setSelectedSubmissionDetail(null);
    setReviewQueue([]);
    setLastReviewedPublishedSubmission(null);
    resetReviewActionState();
  }, [activeView, roleAccess.showReviewTools]);

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
        submitterEmail: roleAccess.submitterEmail,
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
        userEmail: roleAccess.notificationEmail,
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

  async function loadClubFeed() {
    if (!canLoadClubFeed) {
      setClubFeedItems([]);
      return;
    }

    setLoadingClubFeed(true);
    setClubFeedError("");

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const response = await fetch(`${baseUrl}/feed/internal`);
      if (!response.ok) throw new Error(`Club feed failed: ${response.status}`);
      const payload = await response.json();
      const nextItems = Array.isArray(payload.items) ? payload.items : [];
      const imagePreviewUrls = getClubFeedImagePreviewUrls(nextItems);

      await Promise.allSettled(
        imagePreviewUrls.map((previewUrl) => prefetchWithTimeout(previewUrl))
      );

      setClubFeedItems(nextItems);
      setFailedClubFeedImages({});
      setClubFeedLastRefreshedAt(new Date().toISOString());
    } catch (error) {
      setClubFeedError(error.message || "Could not load club feed");
      setStatus(error.message || "Could not load club feed");
    } finally {
      setLoadingClubFeed(false);
    }
  }

  async function fetchSubmissionDetail(submissionId) {
    const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
    const response = await fetch(`${baseUrl}/submissions/${submissionId}`);
    if (!response.ok) throw new Error(`Submission detail failed: ${response.status}`);
    return response.json();
  }

  async function loadSubmissionDetail(submissionId) {
    setLoadingDetail(true);
    try {
      const payload = await fetchSubmissionDetail(submissionId);
      setSelectedSubmissionDetail(payload);
      setSelectedSubmissionId(submissionId);
      setResubmissionText(payload.raw_text || "");
      setResubmissionAsset(null);
      return payload;
    } catch (error) {
      setStatus(error.message || "Could not load submission detail");
      Alert.alert("Detail unavailable", error.message || "Unknown error");
      return null;
    } finally {
      setLoadingDetail(false);
    }
  }

  async function waitForPublishedSubmission(submissionId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const detail = await fetchSubmissionDetail(submissionId);
      if (detail?.publishedPost || detail?.status === "published") {
        return detail;
      }
      await wait(900);
    }

    return fetchSubmissionDetail(submissionId);
  }

  async function sharePublishedSubmission(submission = selectedSubmissionDetail) {
    if (!submission?.publishedPost) {
      Alert.alert("Not published yet", "This post has not reached the club feed yet.");
      return;
    }

    try {
      await Share.share({
        message: buildPublishedShareMessage(submission),
        title: submission.caption_draft || submission.raw_text || "Club update"
      });
    } catch (error) {
      Alert.alert("Share unavailable", error.message || "Could not open sharing.");
    }
  }

  async function markNotificationRead(notificationId) {
    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const response = await fetch(`${baseUrl}/notifications/${notificationId}/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userEmail: roleAccess.notificationEmail })
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
    await Promise.all([loadRecentSubmissions(), loadNotifications(), loadClubFeed()]);
  }

  async function refreshActiveView() {
    setRefreshingView(true);
    try {
      if (activeView === "feed") {
        await loadClubFeed();
        return;
      }

      if (activeView === "review") {
        await loadReviewQueue();
        return;
      }

      if (activeView === "status") {
        await refreshStatusFeed();
        return;
      }

      await refreshStatusFeed();
    } finally {
      setRefreshingView(false);
    }
  }

  async function resubmitSelectedSubmission() {
    if (!selectedSubmissionDetail) return;

    Keyboard.dismiss();
    setResubmittingDetail(true);
    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      let resubmissionMedia = null;

      if (resubmissionAsset) {
        const contentType = isVideoAsset(resubmissionAsset) ? "video" : "photo";
        const signResponse = await fetch(`${baseUrl}/uploads/sign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clubSlug: selectedSubmissionDetail.club_slug,
            files: [
              {
                filename: resubmissionAsset.name,
                mimeType: resubmissionAsset.mimeType || "application/octet-stream",
                mediaType: contentType
              }
            ]
          })
        });

        if (!signResponse.ok) throw new Error(`Replacement upload signing failed: ${signResponse.status}`);
        const signPayload = await signResponse.json();
        const uploadPlan = signPayload.uploads?.[0];
        if (!uploadPlan) throw new Error("Replacement signing returned no upload plan");

        await uploadSelectedAsset(uploadPlan, resubmissionAsset, {
          fileSystem: { File: ExpoFile }
        });
        resubmissionMedia = [
          {
            objectKey: uploadPlan.objectKey,
            mediaType: contentType,
            mimeType: resubmissionAsset.mimeType || "application/octet-stream"
          }
        ];
      }

      const response = await fetch(
        `${baseUrl}/submissions/${selectedSubmissionDetail.id}/resubmit`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            submitterEmail: roleAccess.submitterEmail,
            rawText: resubmissionText.trim(),
            visibilityTarget: selectedSubmissionDetail.visibility_target,
            media: resubmissionMedia
          })
        }
      );

      if (!response.ok) throw new Error(`Resubmit failed: ${response.status}`);

      await loadSubmissionDetail(selectedSubmissionDetail.id);
      await refreshStatusFeed();
      setResubmissionAsset(null);
      setStatus("Resubmitted and back in review.");
      Alert.alert("Back in review", "Your update was sent back into the review queue.");
    } catch (error) {
      setStatus(error.message || "Could not resubmit");
      Alert.alert("Resubmit failed", error.message || "Unknown error");
    } finally {
      setResubmittingDetail(false);
    }
  }

  async function pickReplacementFromLibrary() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to replace this post.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.9,
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled || !result.assets?.length) return;
    setResubmissionAsset(normalizePickedAsset(result.assets[0]));
  }

  async function captureReplacementWithCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow camera access to retake this post.");
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.9,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled || !result.assets?.length) return;
    setResubmissionAsset(normalizePickedAsset(result.assets[0]));
  }

  async function applyResubmitShortcut(shortcut) {
    if (!shortcut) return;

    if (shortcut.mediaAction === "camera") {
      await captureReplacementWithCamera();
      return;
    }

    if (shortcut.mediaAction === "library") {
      await pickReplacementFromLibrary();
      return;
    }

    if (shortcut.text) {
      setResubmissionText((current) => {
        if (!current.trim()) return shortcut.text;
        if (current.includes(shortcut.text)) return current;
        return `${current.trim()}\n${shortcut.text}`;
      });
    }
  }

  useEffect(() => {
    if (!canLoadRecent && !canLoadClubFeed) return;
    refreshStatusFeed();
    const intervalId = setInterval(() => {
      refreshStatusFeed();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [canLoadRecent, canLoadClubFeed, apiBaseUrl, clubSlug, teamSlug, roleAccess.submitterEmail]);

  useEffect(() => {
    if (!canLoadRecent) {
      setPushRegistrationStatus("");
      return;
    }

    let isCurrent = true;

    async function registerForPush() {
      const result = await registerPushToken({
        apiBaseUrl: apiBaseUrl.trim(),
        userEmail: roleAccess.notificationEmail
      });

      if (!isCurrent) return;

      if (result.registered) {
        setPushRegistrationStatus("Push alerts ready");
        return;
      }

      if (result.reason === "permission_denied") {
        setPushRegistrationStatus("Push alerts off");
        return;
      }

      if (result.reason === "missing_project_id") {
        setPushRegistrationStatus("Push alerts need app setup");
        return;
      }

      setPushRegistrationStatus("");
    }

    registerForPush().catch(() => {
      if (isCurrent) setPushRegistrationStatus("");
    });

    return () => {
      isCurrent = false;
    };
  }, [canLoadRecent, apiBaseUrl, roleAccess.notificationEmail]);

  useEffect(() => {
    if (!canReview) return;
    loadReviewQueue();
    if (activeView !== "review") return;
    const intervalId = setInterval(() => {
      loadReviewQueue();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [canReview, apiBaseUrl, roleAccess.reviewActorEmail, activeView]);

  async function loadReviewQueue() {
    if (!canReview) {
      setReviewQueue([]);
      return [];
    }

    setLoadingReviewQueue(true);
    setReviewQueueError("");

    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const response = await fetch(baseUrl + "/approvals/queue");
      if (!response.ok) throw new Error("Review queue failed: " + response.status);
      const payload = await response.json();
      const items = Array.isArray(payload.items) ? payload.items : [];
      setReviewQueue(items);
      return items;
    } catch (error) {
      setReviewQueueError(error.message || "Could not load review queue");
      setStatus(error.message || "Could not load review queue");
      return [];
    } finally {
      setLoadingReviewQueue(false);
    }
  }

  function resetReviewActionState() {
    setReviewAction("approve");
    setReviewActionReasonCode(null);
    setReviewActionNotes("");
    setReviewActionEditorVisible(false);
    setReviewActionStatus("Pick a review item to get started.");
  }

  function selectReviewAction(action) {
    setReviewAction(action);
    setReviewActionStatus("");

    if (action === "approve") {
      setReviewActionReasonCode(null);
      setReviewActionNotes("");
      setReviewActionEditorVisible(false);
      return;
    }

    const reasons = reviewReasonSets[action] || [];
    const first = reasons[0] || null;
    setReviewActionReasonCode(first?.code || null);
    setReviewActionNotes(first?.text || "");
    setReviewActionEditorVisible(true);
  }

  function applyReviewReasonPreset(code, note) {
    setReviewActionReasonCode(code);
    setReviewActionNotes(note);
    setReviewActionEditorVisible(true);
  }

  async function openReviewItem(submissionId) {
    if (!roleAccess.showReviewTools) return;
    setActiveView("review");
    await loadSubmissionDetail(submissionId);
    resetReviewActionState();
  }

  async function submitReviewAction() {
    if (!roleAccess.canReview) {
      Alert.alert("Reviewer mode required", "Switch this device to reviewer mode before approving posts.");
      return;
    }

    const approvalRequestId = selectedSubmissionDetail?.latestApprovalRequest?.id;
    if (!approvalRequestId) return;

    if (reviewAction !== "approve" && !reviewActionNotes.trim()) {
      Alert.alert("Note required", "Add a short note before you send this back or reject it.");
      return;
    }

    setReviewActionInProgress(true);
    Keyboard.dismiss();
    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const reviewedSubmissionId = selectedSubmissionDetail.id;
      const submittedAction = reviewAction;
      const actionLabel =
        submittedAction === "approve"
          ? "Approved"
          : submittedAction === "request_changes"
            ? "Sent back for changes"
            : "Rejected";

      const response = await fetch(baseUrl + "/approval-requests/" + approvalRequestId + "/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: reviewAction,
          actedByEmail: roleAccess.reviewActorEmail,
          notes: reviewAction === "approve" ? null : reviewActionNotes.trim(),
          reasonCode: reviewActionReasonCode
        })
      });

      if (!response.ok) throw await buildApiError(response, "Review action failed");

      setReviewActionStatus(
        submittedAction === "approve"
          ? "Approved. Checking the publish result..."
          : actionLabel + ". Loading the next item..."
      );
      await refreshStatusFeed();
      let reviewedDetail = null;

      if (submittedAction === "approve") {
        try {
          reviewedDetail = await waitForPublishedSubmission(reviewedSubmissionId);
          if (reviewedDetail?.publishedPost) {
            setLastReviewedPublishedSubmission(reviewedDetail);
            setReviewActionStatus(
              `Published to ${reviewedDetail.publishedPost.destinationName}. Loading the next item...`
            );
          } else {
            setReviewActionStatus("Approved. Publishing is still finishing in the background.");
          }
        } catch (confirmationError) {
          setReviewActionStatus("Approved. Could not confirm publishing yet.");
        }
      } else {
        setLastReviewedPublishedSubmission(null);
      }

      const items = await loadReviewQueue();
      const nextItem = items.find((item) => item.submission_id !== reviewedSubmissionId) || items[0] || null;

      if (nextItem?.submission_id) {
        await loadSubmissionDetail(nextItem.submission_id);
        resetReviewActionState();
      } else {
        setReviewActionStatus(actionLabel + ". Queue is clear.");
        setSelectedSubmissionId(null);
        setSelectedSubmissionDetail(null);
      }

      Alert.alert(
        actionLabel,
        submittedAction === "approve"
          ? reviewedDetail?.publishedPost
            ? `Published to ${reviewedDetail.publishedPost.destinationName}.`
            : "It is moving forward."
          : submittedAction === "request_changes"
            ? "The submitter will see your note."
            : "The submitter will be notified."
      );
    } catch (error) {
      setStatus(error.message || "Could not save review action");
      Alert.alert("Review failed", error.message || "Unknown error");
    } finally {
      setReviewActionInProgress(false);
    }
  }

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
      preferredAssetRepresentationMode:
        ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
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

  function replaceDraftMedia() {
    Alert.alert("Replace media", "Retake the moment or choose a different file.", [
      { text: "Retake", onPress: captureWithCamera },
      { text: "Choose library", onPress: pickFromLibrary },
      { text: "Cancel", style: "cancel" }
    ]);
  }

  function clearDraft() {
    setAsset(null);
    setCaption("");
    setStatus("Take a photo or choose one to get started.");
  }

  async function submit() {
    if (!asset) return;

    Keyboard.dismiss();
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
              mediaType: contentType
            }
          ]
        })
      });

      if (!signResponse.ok) throw new Error(`Upload signing failed: ${signResponse.status}`);
      const signPayload = await signResponse.json();
      const uploadPlan = signPayload.uploads?.[0];
      if (!uploadPlan) throw new Error("Upload signing returned no upload plan");

      setStatus("Uploading media...");
      await uploadSelectedAsset(uploadPlan, asset, {
        fileSystem: { File: ExpoFile }
      });

      setStatus("Creating submission...");
      const submissionResponse = await fetch(`${baseUrl}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clubSlug,
          teamSlug,
          submitterEmail: roleAccess.submitterEmail,
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

      if (!submissionResponse.ok) throw new Error(`Submission failed: ${submissionResponse.status}`);
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

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <KeyboardAvoidingView
          style={styles.screen}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
        <LinearGradient
          colors={["#f4f0ff", "#ece8ff", "#eaf8ff"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.screenGradient}
        />
        <View style={styles.backgroundGlowA} />
        <View style={styles.backgroundGlowB} />
        <View style={styles.backgroundGlowC} />

        <View style={styles.chromeBar}>
          <View>
            <Text style={styles.appName}>Club Content</Text>
            <Text style={styles.appSubtitle}>{roleAccess.label} workspace</Text>
          </View>
          <Pressable style={styles.settingsButton} onPress={() => setSettingsVisible(true)}>
            <Text style={styles.settingsButtonText}>Settings</Text>
          </Pressable>
        </View>

        <View style={styles.segmentRow}>
          <Pressable
            style={[styles.segmentButton, activeView === "post" && styles.segmentButtonActive]}
            onPress={() => setActiveView("post")}
          >
            <Text style={[styles.segmentText, activeView === "post" && styles.segmentTextActive]}>Post</Text>
          </Pressable>
          {roleAccess.showReviewTools ? (
            <Pressable
              style={[styles.segmentButton, activeView === "review" && styles.segmentButtonActive]}
              onPress={() => setActiveView("review")}
            >
              <Text style={[styles.segmentText, activeView === "review" && styles.segmentTextActive]}>
                Review{reviewQueue.length ? ` (${reviewQueue.length})` : ""}
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            style={[styles.segmentButton, activeView === "feed" && styles.segmentButtonActive]}
            onPress={() => setActiveView("feed")}
          >
            <Text style={[styles.segmentText, activeView === "feed" && styles.segmentTextActive]}>
              Feed
            </Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, activeView === "status" && styles.segmentButtonActive]}
            onPress={() => setActiveView("status")}
          >
            <Text style={[styles.segmentText, activeView === "status" && styles.segmentTextActive]}>
              Status{unreadNotificationCount ? ` (${unreadNotificationCount})` : ""}
            </Text>
          </Pressable>
        </View>

        <ScrollView
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshingView}
              onRefresh={refreshActiveView}
              tintColor="#37306c"
            />
          }
          contentContainerStyle={[
            styles.container,
            asset && styles.containerWithKeyboardBuffer
          ]}
        >
          {activeView === "post" ? (
            <>
              {!asset ? (
                <View style={styles.captureStage}>
                  <GlassLayer />
                  <View style={styles.captureGlowOne} />
                  <View style={styles.captureGlowTwo} />
                  <Text style={styles.captureKicker}>Capture first</Text>
                  <Text style={styles.captureTitle}>Capture the moment</Text>
                  <Text style={styles.captureBody}>
                    Take a quick photo or choose one from your library. Keep it simple and keep it moving.
                  </Text>

                  <View style={styles.captureActionStack}>
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
                <View style={styles.previewStage}>
                  {isVideoAsset(asset) ? (
                    <View style={styles.videoPreviewStage}>
                      <LinearGradient
                        colors={["rgba(171, 161, 247, 0.20)", "rgba(44, 34, 96, 0.92)"]}
                        start={{ x: 0.18, y: 0 }}
                        end={{ x: 0.82, y: 1 }}
                        style={styles.previewImageShade}
                      >
                        <View style={styles.previewTopBar}>
                          <View>
                            <Text style={styles.previewEyebrow}>Preview</Text>
                            <Text style={styles.previewHeroTitle}>Ready to post?</Text>
                          </View>
                          <Pressable style={styles.previewTopButton} onPress={clearDraft}>
                            <Text style={styles.previewTopButtonText}>Start over</Text>
                          </Pressable>
                        </View>

                        <View style={styles.previewBottomStack}>
                          <View style={styles.previewChipRow}>
                            <View style={styles.previewChip}>
                              <Text style={styles.previewChipText}>Video</Text>
                            </View>
                            <View style={styles.previewChip}>
                              <Text style={styles.previewChipText}>{formatVisibilityLabel(visibilityTarget)}</Text>
                            </View>
                          </View>
                          <View style={styles.previewMediaOverlay}>
                            <Text style={styles.videoPreviewName}>{asset.name}</Text>
                            <Text style={styles.videoPreviewCopy}>
                              Playback preview is the next upgrade. For now, this clip is selected and ready to submit.
                            </Text>
                          </View>
                        </View>
                      </LinearGradient>
                    </View>
                  ) : (
                    <ImageBackground source={{ uri: asset.uri }} style={styles.previewImage} imageStyle={styles.previewImageMedia}>
                      <LinearGradient
                        colors={["rgba(255,255,255,0.08)", "rgba(64, 54, 124, 0.14)", "rgba(26, 22, 58, 0.78)"]}
                        locations={[0, 0.54, 1]}
                        start={{ x: 0.5, y: 0 }}
                        end={{ x: 0.5, y: 1 }}
                        style={styles.previewImageShade}
                      >
                        <View style={styles.previewTopBar}>
                          <View>
                            <Text style={styles.previewEyebrow}>Preview</Text>
                            <Text style={styles.previewHeroTitle}>Ready to post?</Text>
                          </View>
                          <Pressable style={styles.previewTopButton} onPress={clearDraft}>
                            <Text style={styles.previewTopButtonText}>Start over</Text>
                          </Pressable>
                        </View>

                        <View style={styles.previewBottomStack}>
                          <View style={styles.previewChipRow}>
                            <View style={styles.previewChip}>
                              <Text style={styles.previewChipText}>Photo</Text>
                            </View>
                            <View style={styles.previewChip}>
                              <Text style={styles.previewChipText}>{formatVisibilityLabel(visibilityTarget)}</Text>
                            </View>
                          </View>
                          <View style={styles.previewMediaOverlay}>
                            <Text style={styles.previewAssetName}>{asset.name}</Text>
                            <Text style={styles.previewOverlayHint}>Check the shot, add a short note, and send it in.</Text>
                          </View>
                        </View>
                      </LinearGradient>
                    </ImageBackground>
                  )}

                  <View style={styles.composerSheet}>
                    <GlassLayer />
                    <View style={styles.sheetHandle} />
                    <View style={styles.sheetTopRow}>
                      <View>
                        <Text style={styles.sheetLabel}>Almost there</Text>
                        <Text style={styles.sheetTitle}>Add a quick note and send it in.</Text>
                      </View>
                      <View style={styles.inlineMetaPill}>
                        <Text style={styles.inlineMetaPillText}>{formatVisibilityLabel(visibilityTarget)}</Text>
                      </View>
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
                      blurOnSubmit
                      enablesReturnKeyAutomatically
                      returnKeyType="send"
                      style={styles.captionInput}
                      value={caption}
                      onChangeText={setCaption}
                      onSubmitEditing={() => {
                        if (canSubmit && !submitting) submit();
                      }}
                      placeholder="Add a short caption if it helps."
                      placeholderTextColor="#8f908c"
                    />

                    <View style={styles.submitRow}>
                      <Pressable style={styles.inlineButton} onPress={replaceDraftMedia}>
                        <Text style={styles.inlineButtonText}>Retake or choose</Text>
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
                </View>
              )}

              <View style={styles.miniStatusCard}>
                <GlassLayer />
                <Text style={styles.miniStatusKicker}>Latest status</Text>
                <Text style={styles.miniStatusTitle}>
                  {latestSubmission ? formatStatusLabel(latestSubmission.status) : "No posts yet"}
                </Text>
                <Text style={styles.miniStatusBody}>{latestStatusSummary}</Text>
                {latestSubmission ? (
                  <View style={styles.inlineStatusActions}>
                    <Pressable style={styles.inlineStatusLink} onPress={() => setActiveView("status")}>
                      <Text style={styles.inlineStatusLinkText}>Open status feed</Text>
                    </Pressable>
                    {latestSubmission.status === "published" ? (
                      <Pressable style={styles.inlineStatusLink} onPress={() => setActiveView("feed")}>
                        <Text style={styles.inlineStatusLinkText}>Open club feed</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </>
          ) : activeView === "review" && roleAccess.showReviewTools ? (
            <>
              <View style={styles.statusHeroCard}>
                <GlassLayer />
                <Text style={styles.statusHeroKicker}>Reviewer</Text>
                <Text style={styles.statusHeroTitle}>One item at a time.</Text>
                <Text style={styles.statusHeroBody}>
                  Tap a queue item to open the post, see the recommendation, and make the call without digging through extra detail.
                </Text>
                <View style={styles.statusSummaryRow}>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>{reviewQueue.length}</Text>
                    <Text style={styles.statusSummaryLabel}>Waiting</Text>
                  </View>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>
                      {selectedSubmissionDetail?.latestApprovalRequest?.state === "pending" ? 1 : 0}
                    </Text>
                    <Text style={styles.statusSummaryLabel}>Open</Text>
                  </View>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>
                      {reviewAction === "approve" ? "A" : reviewAction === "request_changes" ? "C" : "R"}
                    </Text>
                    <Text style={styles.statusSummaryLabel}>Mode</Text>
                  </View>
                </View>
                <Text style={styles.reviewQueueHint}>
                  {roleAccess.reviewActorEmail ? `Signed in as ${roleAccess.reviewActorEmail}.` : "Add your reviewer email in Settings to use this view."}
                </Text>
              </View>

              {lastReviewedPublishedSubmission?.publishedPost ? (
                <View style={styles.reviewerPublishedCard}>
                  <GlassLayer />
                  <View style={styles.publishedDetailHeader}>
                    <View>
                      <Text style={styles.publishedDetailKicker}>Last approved</Text>
                      <Text style={styles.publishedDetailTitle}>Published to feed</Text>
                    </View>
                    <View style={[styles.statusBadge, styles.statusBadgeSuccess]}>
                      <Text style={[styles.statusBadgeText, styles.statusBadgeTextSuccess]}>Live</Text>
                    </View>
                  </View>
                  <Text style={styles.publishedCaption}>
                    {lastReviewedPublishedSubmission.caption_draft?.trim() ||
                      lastReviewedPublishedSubmission.raw_text?.trim() ||
                      "No caption provided"}
                  </Text>
                  <Text style={styles.feedSupport}>
                    {lastReviewedPublishedSubmission.publishedPost.destinationName} · {formatSubmittedAt(lastReviewedPublishedSubmission.publishedPost.publishedAt)}
                  </Text>
                  {lastReviewedPublishedSubmission.routing_decision ? (
                    <View style={styles.metaChipRow}>
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>
                          Route: {formatRoutingSourceLabel(lastReviewedPublishedSubmission.routing_decision.routingSource)}
                        </Text>
                      </View>
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>
                          Approver: {formatApprovalRoleLabel(lastReviewedPublishedSubmission.latestApprovalRequest?.approverRole)}
                        </Text>
                      </View>
                    </View>
                  ) : null}
                  <View style={styles.publishedActionRow}>
                    <Pressable
                      style={styles.publishedPrimaryButton}
                      onPress={() => sharePublishedSubmission(lastReviewedPublishedSubmission)}
                    >
                      <Text style={styles.publishedPrimaryButtonText}>Share post</Text>
                    </Pressable>
                    <Pressable
                      style={styles.publishedSecondaryButton}
                      onPress={() => {
                        setSelectedSubmissionDetail(lastReviewedPublishedSubmission);
                        setSelectedSubmissionId(lastReviewedPublishedSubmission.id);
                      }}
                    >
                      <Text style={styles.publishedSecondaryButtonText}>Open detail</Text>
                    </Pressable>
                    <Pressable
                      style={styles.publishedSecondaryButton}
                      onPress={() => setActiveView("feed")}
                    >
                      <Text style={styles.publishedSecondaryButtonText}>Open feed</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Queue</Text>
                    <Text style={styles.sectionTitle}>Pending reviews</Text>
                  </View>
                  <Pressable style={styles.topGhostButton} onPress={loadReviewQueue}>
                    <Text style={styles.topGhostButtonText}>
                      {loadingReviewQueue ? "Loading" : "Refresh"}
                    </Text>
                  </Pressable>
                </View>

                {reviewQueue.length ? (
                  reviewQueue.map((item, index) => (
                    <Pressable
                      key={item.id}
                      style={[styles.feedCard, index === 0 && styles.feedCardFeatured]}
                      onPress={() => openReviewItem(item.submission_id || item.submissionId)}
                    >
                      <GlassLayer />
                      <View style={styles.statusBadgeRow}>
                        <View style={styles.statusBadge}>
                          <Text style={styles.statusBadgeText}>{index === 0 ? "Up next" : `Then ${index + 1}`}</Text>
                        </View>
                        <Text style={styles.feedTime}>{formatSubmittedAt(item.created_at)}</Text>
                      </View>
                      <Text style={styles.feedHeadline}>{item.raw_text?.trim() || "No caption provided"}</Text>
                      <Text style={styles.feedSupport}>
                        {item.latest_review_summary || summarizeSubmissionProgress({ status: "needs_human_review" })}
                      </Text>
                      <View style={styles.metaChipRow}>
                        <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>
                            {item.team_name || formatContentTypeLabel(item.content_type)}
                          </Text>
                        </View>
                      <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>
                            {formatRiskScoreLabel(item.risk_score)}
                          </Text>
                        </View>
                        {item.routing_decision ? (
                          <View style={styles.metaChip}>
                            <Text style={styles.metaChipText}>
                              Route: {formatRoutingSourceLabel(item.routing_decision.routingSource)}
                            </Text>
                          </View>
                        ) : null}
                        {item.approverRole ? (
                          <View style={styles.metaChip}>
                            <Text style={styles.metaChipText}>
                              Approver: {formatApprovalRoleLabel(item.approverRole)}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </Pressable>
                  ))
                ) : loadingReviewQueue ? (
                  <Text style={styles.emptyStateText}>Loading reviews…</Text>
                ) : reviewQueueError ? (
                  <Text style={styles.errorStateText}>{reviewQueueError}</Text>
                ) : (
                  <Text style={styles.emptyStateText}>No pending reviews right now.</Text>
                )}
              </View>

              {selectedSubmissionDetail ? (
                <View style={styles.sectionBlock}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <Text style={styles.sectionKicker}>Current item</Text>
                      <Text style={styles.sectionTitle}>Open the detail sheet</Text>
                    </View>
                    <Pressable style={styles.topGhostButton} onPress={() => setSelectedSubmissionId(selectedSubmissionDetail.id)}>
                      <Text style={styles.topGhostButtonText}>Open</Text>
                    </Pressable>
                  </View>
                  <Text style={styles.emptyStateText}>
                    The selected post is ready in the detail sheet. Open it to review the media and send back or approve.
                  </Text>
                </View>
              ) : null}
            </>
          ) : activeView === "feed" ? (
            <>
              <View style={styles.statusHeroCard}>
                <GlassLayer />
                <Text style={styles.statusHeroKicker}>Club feed</Text>
                <Text style={styles.statusHeroTitle}>Approved posts, ready to share.</Text>
                <Text style={styles.statusHeroBody}>
                  This is what made it through review and into the internal club feed.
                </Text>
                <View style={styles.statusSummaryRow}>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>{clubFeedItems.length}</Text>
                    <Text style={styles.statusSummaryLabel}>Posted</Text>
                  </View>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>
                      {clubFeedItems.filter((item) => item.media?.length).length}
                    </Text>
                    <Text style={styles.statusSummaryLabel}>With media</Text>
                  </View>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>Live</Text>
                    <Text style={styles.statusSummaryLabel}>Feed</Text>
                  </View>
                </View>
                <View style={styles.feedCheckPanel}>
                  <View>
                    <Text style={styles.feedCheckLabel}>Last feed check</Text>
                    <Text style={styles.feedCheckValue}>
                      {formatLastUpdatedLabel(clubFeedLastRefreshedAt)}
                    </Text>
                  </View>
                  {loadingClubFeed || refreshingView ? (
                    <View style={styles.feedCheckBadge}>
                      <ActivityIndicator color="#5b52ba" size="small" />
                      <Text style={styles.feedCheckBadgeText}>Checking</Text>
                    </View>
                  ) : (
                    <Text style={styles.feedCheckReady}>Ready</Text>
                  )}
                </View>
              </View>

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Internal feed</Text>
                    <Text style={styles.sectionTitle}>Latest club posts</Text>
                  </View>
                  <Pressable
                    style={styles.topGhostButton}
                    onPress={activeView === "feed" ? refreshActiveView : loadClubFeed}
                  >
                    <Text style={styles.topGhostButtonText}>
                      {getRefreshButtonLabel(loadingClubFeed || refreshingView)}
                    </Text>
                  </Pressable>
                </View>

                {clubFeedItems.length ? (
                  clubFeedItems.map((item, index) => {
                    const previewMedia = getPrimaryClubFeedImagePreviewMedia(item);
                    const mediaStatusKey = previewMedia?.previewUrl || `${item.id}-primary-media`;
                    const imageFailed = Boolean(failedClubFeedImages[mediaStatusKey]);
                    return (
                      <View key={item.id} style={[styles.feedCard, index === 0 && styles.feedCardFeatured]}>
                        <GlassLayer />
                        {previewMedia?.previewUrl ? (
                          <View style={styles.clubFeedMediaFrame}>
                            <Image
                              source={{ uri: previewMedia.previewUrl }}
                              style={styles.clubFeedImage}
                              resizeMode="cover"
                              onLoad={() =>
                                setFailedClubFeedImages((current) => {
                                  if (!current[mediaStatusKey]) return current;
                                  const next = { ...current };
                                  delete next[mediaStatusKey];
                                  return next;
                                })
                              }
                              onError={() => {
                                setFailedClubFeedImages((current) => ({
                                  ...current,
                                  [mediaStatusKey]: true
                                }));
                                setStatus("Feed image could not load. Refresh the feed or check the media URL in Settings.");
                              }}
                            />
                            {imageFailed ? (
                              <View style={styles.clubFeedImageFallback}>
                                <Text style={styles.clubFeedImageFallbackTitle}>Image unavailable</Text>
                                <Text style={styles.clubFeedImageFallbackCopy}>Refresh the feed to try again.</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                        <View style={styles.statusBadgeRow}>
                          <View style={[styles.statusBadge, styles.statusBadgeSuccess]}>
                            <Text style={[styles.statusBadgeText, styles.statusBadgeTextSuccess]}>Posted</Text>
                          </View>
                          <Text style={styles.feedTime}>{formatSubmittedAt(item.published_at)}</Text>
                        </View>
                        <Text style={styles.feedHeadline}>{item.caption_draft || item.raw_text?.trim() || "No caption provided"}</Text>
                        <Text style={styles.feedSupport}>
                          Published to {item.destination_name || "the internal feed"}.
                        </Text>
                        <View style={styles.metaChipRow}>
                          <View style={styles.metaChip}>
                            <Text style={styles.metaChipText}>{formatContentTypeLabel(item.content_type)}</Text>
                          </View>
                          <View style={styles.metaChip}>
                            <Text style={styles.metaChipText}>{formatVisibilityLabel(item.visibility_target)}</Text>
                          </View>
                          {item.media?.length ? (
                            <View style={styles.metaChip}>
                              <Text style={styles.metaChipText}>{formatMediaCountLabel(item.media.length)}</Text>
                            </View>
                          ) : null}
                          {item.routing_decision ? (
                            <View style={styles.metaChip}>
                              <Text style={styles.metaChipText}>
                                Route: {formatRoutingSourceLabel(item.routing_decision.routingSource)}
                              </Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    );
                  })
                ) : loadingClubFeed ? (
                  <Text style={styles.emptyStateText}>Loading the club feed...</Text>
                ) : clubFeedError ? (
                  <Text style={styles.errorStateText}>{clubFeedError}</Text>
                ) : (
                  <Text style={styles.emptyStateText}>Approved club posts will show here.</Text>
                )}
              </View>
            </>
          ) : (
            <>
              <View style={styles.statusHeroCard}>
                <GlassLayer />
                <Text style={styles.statusHeroKicker}>Your posts</Text>
                <Text style={styles.statusHeroTitle}>Clear status, no digging.</Text>
                <Text style={styles.statusHeroBody}>
                  The latest changes show up here so you can see what moved, what needs attention, and what already made it through.
                </Text>
                <View style={styles.statusSummaryRow}>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>{submissionStats.inReview}</Text>
                    <Text style={styles.statusSummaryLabel}>In review</Text>
                  </View>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>{submissionStats.needsAttention}</Text>
                    <Text style={styles.statusSummaryLabel}>Needs you</Text>
                  </View>
                  <View style={styles.statusSummaryPill}>
                    <Text style={styles.statusSummaryValue}>{submissionStats.published}</Text>
                    <Text style={styles.statusSummaryLabel}>Posted</Text>
                  </View>
                </View>
              </View>

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Newest post</Text>
                    <Text style={styles.sectionTitle}>Where it stands</Text>
                  </View>
                  <Pressable style={styles.topGhostButton} onPress={refreshStatusFeed}>
                    <Text style={styles.topGhostButtonText}>
                      {loadingRecent || loadingNotifications ? "Refreshing" : "Refresh"}
                    </Text>
                  </Pressable>
                </View>

                {latestSubmission ? (
                  <View style={styles.latestPostCard}>
                    <GlassLayer />
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
                                state === "complete" && styles.progressDotComplete,
                                state === "current" && styles.progressDotCurrent
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
                    </View>

                    {latestSubmission.status === "published" ? (
                      <View style={styles.publishedActionRow}>
                        <Pressable
                          style={styles.publishedPrimaryButton}
                          onPress={() => loadSubmissionDetail(latestSubmission.id)}
                        >
                          <Text style={styles.publishedPrimaryButtonText}>View published post</Text>
                        </Pressable>
                        <Pressable
                          style={styles.publishedSecondaryButton}
                          onPress={() => setActiveView("feed")}
                        >
                          <Text style={styles.publishedSecondaryButtonText}>Open feed</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                ) : loadingRecent ? (
                  <Text style={styles.emptyStateText}>Loading your latest post…</Text>
                ) : recentError ? (
                  <Text style={styles.errorStateText}>{recentError}</Text>
                ) : (
                  <Text style={styles.emptyStateText}>When you submit a photo or video, the review timeline will show here.</Text>
                )}
              </View>

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Recent posts</Text>
                    <Text style={styles.sectionTitle}>Submission history</Text>
                  </View>
                </View>

                {recentSubmissions.length ? (
                  recentSubmissions.map((item, index) => (
                    <Pressable key={item.id} style={[styles.feedCard, index === 0 && styles.feedCardFeatured]} onPress={() => loadSubmissionDetail(item.id)}>
                      <GlassLayer />
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
                      {item.status === "published" ? (
                        <Text style={styles.feedPublishedHint}>Tap to view the finished club post.</Text>
                      ) : null}
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

              <View style={styles.sectionBlock}>
                <View style={styles.sectionHeader}>
                  <View>
                    <Text style={styles.sectionKicker}>Updates</Text>
                    <Text style={styles.sectionTitle}>Notifications</Text>
                  </View>
                  <Text style={styles.unreadBadge}>
                    {unreadNotificationCount ? `${unreadNotificationCount} unread` : "All caught up"}
                  </Text>
                </View>
                {pushRegistrationStatus ? (
                  <Text style={styles.pushRegistrationStatus}>{pushRegistrationStatus}</Text>
                ) : null}

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
                      <GlassLayer />
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
      </KeyboardAvoidingView>

      <Modal visible={settingsVisible} animationType="slide" transparent onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <GlassLayer />
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionKicker}>Settings</Text>
                <Text style={styles.sectionTitle}>Your workspace setup</Text>
              </View>
              <Pressable onPress={() => setSettingsVisible(false)}>
                <Text style={styles.closeButtonText}>Done</Text>
              </Pressable>
            </View>

            <ScrollView
              style={styles.settingsScroll}
              contentContainerStyle={styles.settingsScrollContent}
              showsVerticalScrollIndicator
            >
              <View style={styles.settingsCard}>
                <GlassLayer />
                <Text style={styles.settingsLabel}>Device role</Text>
                <View style={styles.audienceRow}>
                  {[
                    { key: "submitter", label: "Submitter" },
                    { key: "reviewer", label: "Reviewer" }
                  ].map((option) => (
                    <Pressable
                      key={option.key}
                      style={[
                        styles.audiencePill,
                        roleAccess.mode === option.key && styles.audiencePillActive
                      ]}
                      onPress={() => setRoleMode(option.key)}
                    >
                      <Text
                        style={[
                          styles.audiencePillText,
                          roleAccess.mode === option.key && styles.audiencePillTextActive
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Text style={styles.advancedHelpText}>
                  Submitters post and track their own content. Reviewers approve or send content back.
                </Text>
              </View>

            <View style={styles.settingsCard}>
              <GlassLayer />
              <Text style={styles.settingsLabel}>Submitter email</Text>
              <TextInput
                autoCapitalize="none"
                style={styles.input}
                value={submitterEmail}
                onChangeText={setSubmitterEmail}
                placeholder="Submitter email"
              />
            </View>

            {roleAccess.showReviewTools ? (
              <View style={styles.settingsCard}>
                <GlassLayer />
                <Text style={styles.settingsLabel}>Reviewer email</Text>
                <TextInput
                  autoCapitalize="none"
                  style={styles.input}
                  value={reviewerEmail}
                  onChangeText={setReviewerEmail}
                  placeholder="Reviewer email"
                />
                <Text style={styles.advancedHelpText}>
                  Used only for approval actions in reviewer mode.
                </Text>
              </View>
            ) : null}

            <View style={styles.settingsCard}>
              <GlassLayer />
              <Text style={styles.settingsLabel}>Club</Text>
              <TextInput style={styles.input} value={clubSlug} onChangeText={setClubSlug} placeholder="Club slug" />
              <TextInput style={[styles.input, styles.settingsStackTop]} value={teamSlug} onChangeText={setTeamSlug} placeholder="Team slug" />
            </View>

            <View style={styles.settingsCard}>
              <GlassLayer />
              <Text style={styles.settingsLabel}>Audience default</Text>
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
            </View>

            <Pressable style={styles.advancedToggle} onPress={() => setShowAdvancedSettings((current) => !current)}>
              <Text style={styles.advancedToggleTitle}>Advanced connection</Text>
              <Text style={styles.advancedToggleCopy}>
                {showAdvancedSettings ? "Hide backend settings" : "Show backend settings used for internal and beta builds"}
              </Text>
            </Pressable>

            {showAdvancedSettings ? (
              <View style={styles.settingsCard}>
                <Text style={styles.settingsLabel}>API base URL</Text>
                <TextInput
                  autoCapitalize="none"
                  style={styles.input}
                  value={apiBaseUrl}
                  onChangeText={setApiBaseUrl}
                  placeholder="API base URL"
                />
                <Text style={styles.advancedHelpText}>
                  For TestFlight and production-style builds, this should be preconfigured so normal users never need to edit it.
                </Text>
              </View>
            ) : null}

            <View style={styles.settingsCard}>
              <GlassLayer />
              <View style={styles.buildInfoHeader}>
                <View>
                  <Text style={styles.settingsLabel}>Build info</Text>
                  <Text style={styles.buildInfoTitle}>{appBuildInfo.appName}</Text>
                </View>
                <View style={styles.inlineMetaPill}>
                  <Text style={styles.inlineMetaPillText}>QA</Text>
                </View>
              </View>
              <View style={styles.buildInfoGrid}>
                {[
                  { label: "Version", value: appBuildInfo.appVersion },
                  { label: "Build", value: appBuildInfo.buildNumber },
                  { label: "API", value: normalizeApiBaseUrl(apiBaseUrl) || "not set" },
                  {
                    label: "Backend rules",
                    value: loadingAppReadiness
                      ? "Checking"
                      : appReadinessError || appReadinessSummary
                  },
                  {
                    label: "Review",
                    value: formatCapability(Boolean(readinessCapabilities.review))
                  },
                  {
                    label: "Publishing",
                    value: formatCapability(Boolean(readinessCapabilities.publishing))
                  },
                  { label: "Role", value: roleAccess.mode },
                  { label: "Bundle", value: appBuildInfo.bundleIdentifier },
                  { label: "EAS project", value: appBuildInfo.easProjectId },
                  { label: "Runtime", value: appBuildInfo.executionEnvironment }
                ].map((item) => (
                  <View key={item.label} style={styles.buildInfoRow}>
                    <Text style={styles.buildInfoLabel}>{item.label}</Text>
                    <Text selectable style={styles.buildInfoValue}>{item.value}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.advancedHelpText}>
                Use this when checking TestFlight builds so everyone is looking at the same app, API, and role.
              </Text>
            </View>
            </ScrollView>
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

                {selectedSubmissionDetail.media?.length || resubmissionAsset ? (
                  <View style={styles.detailMediaCard}>
                    {resubmissionAsset && !isVideoAsset(resubmissionAsset) ? (
                      <Image
                        source={{ uri: resubmissionAsset.uri }}
                        style={styles.detailMediaPreview}
                      />
                    ) : getPrimaryClubFeedImagePreviewMedia(selectedSubmissionDetail)?.previewUrl ? (
                      <Image
                        source={{ uri: getPrimaryClubFeedImagePreviewMedia(selectedSubmissionDetail).previewUrl }}
                        style={styles.detailMediaPreview}
                      />
                    ) : (
                      <View style={styles.detailMediaFallback}>
                        <Text style={styles.detailMediaFallbackLabel}>
                          {resubmissionAsset
                            ? formatContentTypeLabel(
                                isVideoAsset(resubmissionAsset) ? "video" : "photo"
                              )
                            : formatContentTypeLabel(selectedSubmissionDetail.content_type)}
                        </Text>
                        <Text style={styles.detailMediaFallbackBody}>
                          {resubmissionAsset
                            ? "Replacement media selected. This will replace the current attachment when you resubmit."
                            : "Preview is limited for this asset, but this is the media currently attached to the post you are editing."}
                        </Text>
                      </View>
                    )}
                    <View style={styles.detailMediaMetaRow}>
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>
                          {formatMediaCountLabel(
                            resubmissionAsset ? 1 : selectedSubmissionDetail.media?.length
                          )}
                        </Text>
                      </View>
                      <View style={styles.metaChip}>
                        <Text style={styles.metaChipText}>
                          {resubmissionAsset
                            ? formatContentTypeLabel(
                                isVideoAsset(resubmissionAsset) ? "video" : "photo"
                              )
                            : formatContentTypeLabel(selectedSubmissionDetail.content_type)}
                        </Text>
                      </View>
                      {resubmissionAsset ? (
                        <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>Replacement ready</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : null}

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

                {selectedSubmissionDetail.routing_decision ? (
                  <View style={styles.metaChipRow}>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>
                        Route: {formatRoutingSourceLabel(selectedSubmissionDetail.routing_decision.routingSource)}
                      </Text>
                    </View>
                    <View style={styles.metaChip}>
                      <Text style={styles.metaChipText}>
                        Routed to: {formatStatusLabel(
                          selectedSubmissionDetail.routing_decision.approverRole ||
                            selectedSubmissionDetail.latestApprovalRequest?.approverRole
                        )}
                      </Text>
                    </View>
                  </View>
                ) : null}

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

                {activeView === "review" && roleAccess.canReview && selectedSubmissionDetail.latestApprovalRequest?.state === "pending" ? (
                  <View style={styles.reviewActionPanel}>
                    <Text style={styles.detailHeading}>Quick review</Text>
                    <Text style={styles.reviewActionTitle}>Pick the action, then keep moving.</Text>
                    <View style={styles.detailMediaActionRow}>
                      {[
                        { action: "approve", label: "Approve" },
                        { action: "request_changes", label: "Send back" },
                        { action: "reject", label: "Reject" }
                      ].map((option) => (
                        <Pressable
                          key={option.action}
                          style={[
                            styles.detailMediaActionButton,
                            reviewAction === option.action && styles.reviewActionButtonActive,
                            option.action === "approve" && styles.reviewActionButtonApprove,
                            option.action === "request_changes" && styles.reviewActionButtonChanges,
                            option.action === "reject" && styles.reviewActionButtonReject
                          ]}
                          onPress={() => selectReviewAction(option.action)}
                        >
                          <Text
                            style={[
                              styles.detailMediaActionText,
                              reviewAction === option.action && styles.reviewActionButtonTextActive,
                              option.action === "approve" && styles.reviewActionButtonTextApprove,
                              option.action === "request_changes" && styles.reviewActionButtonTextChanges,
                              option.action === "reject" && styles.reviewActionButtonTextReject
                            ]}
                          >
                            {option.label}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    {reviewAction !== "approve" ? (
                      <View style={styles.reviewReasonSection}>
                        <Text style={styles.reviewActionLabel}>Pick the closest fix path.</Text>
                        <View style={styles.detailShortcutRow}>
                          {(reviewReasonSets[reviewAction] || []).map((reason) => (
                            <Pressable
                              key={reason.code}
                              style={[
                                styles.detailShortcutButton,
                                reviewActionReasonCode === reason.code && styles.reviewShortcutActive
                              ]}
                              onPress={() => applyReviewReasonPreset(reason.code, reason.text)}
                            >
                              <Text style={styles.detailShortcutText}>{reason.label}</Text>
                            </Pressable>
                          ))}
                        </View>

                        <View style={styles.reviewNoteCard}>
                          <Text style={styles.reviewNoteTitle}>Ready to send</Text>
                          <Text style={styles.reviewNoteBody}>
                            {reviewActionNotes.trim() || "Pick a reason and the note will be filled in."}
                          </Text>
                          <Pressable onPress={() => setReviewActionEditorVisible((current) => !current)}>
                            <Text style={styles.inlineStatusLinkText}>
                              {reviewActionEditorVisible ? "Hide editor" : "Edit note"}
                            </Text>
                          </Pressable>
                        </View>

                        {reviewActionEditorVisible ? (
                          <TextInput
                            multiline
                            blurOnSubmit
                            enablesReturnKeyAutomatically
                            returnKeyType="send"
                            style={styles.detailResubmitInput}
                            value={reviewActionNotes}
                            onChangeText={setReviewActionNotes}
                            onSubmitEditing={() => {
                              if (
                                roleAccess.canReview &&
                                !reviewActionInProgress &&
                                (reviewAction === "approve" || reviewActionNotes.trim())
                              ) {
                                submitReviewAction();
                              }
                            }}
                            placeholder="Add a short note."
                            placeholderTextColor="#8f908c"
                          />
                        ) : null}
                      </View>
                    ) : null}

                    <Pressable
                      disabled={reviewActionInProgress || (reviewAction !== "approve" && !reviewActionNotes.trim())}
                      style={[
                        styles.detailResubmitButton,
                        reviewAction === "approve" && styles.reviewActionApproveButton,
                        reviewAction === "request_changes" && styles.reviewActionChangesButton,
                        reviewAction === "reject" && styles.reviewActionRejectButton,
                        (reviewActionInProgress || (reviewAction !== "approve" && !reviewActionNotes.trim())) && styles.buttonDisabled
                      ]}
                      onPress={submitReviewAction}
                    >
                      {reviewActionInProgress ? (
                        <ActivityIndicator color="#fffdf8" />
                      ) : (
                        <Text style={styles.detailResubmitButtonText}>
                          {reviewAction === "approve"
                            ? "Approve and next"
                            : reviewAction === "request_changes"
                              ? "Send back"
                              : "Reject submission"}
                        </Text>
                      )}
                    </Pressable>

                    {reviewActionStatus ? <Text style={styles.reviewActionStatus}>{reviewActionStatus}</Text> : null}
                  </View>
                ) : null}

                {selectedSubmissionDetail.status === "needs_metadata" ? (
                  <>
                    <Text style={styles.detailHeading}>{resubmitPrompt.title}</Text>
                    <Text style={styles.detailBody}>
                      {selectedSubmissionDetail.latestApprovalRequest?.latestAction?.notes ||
                        resubmitPrompt.body}
                    </Text>
                    <Text style={styles.detailSupportCallout}>{resubmitPrompt.body}</Text>
                    {resubmitShortcuts.length ? (
                      <View style={styles.detailShortcutRow}>
                        {resubmitShortcuts.map((shortcut) => (
                          <Pressable
                            key={shortcut.label}
                            style={styles.detailShortcutButton}
                            onPress={() => applyResubmitShortcut(shortcut)}
                          >
                            <Text style={styles.detailShortcutText}>{shortcut.label}</Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <View style={styles.detailMediaActionRow}>
                      <Pressable style={styles.detailMediaActionButton} onPress={captureReplacementWithCamera}>
                        <Text style={styles.detailMediaActionText}>Retake media</Text>
                      </Pressable>
                      <Pressable style={styles.detailMediaActionButton} onPress={pickReplacementFromLibrary}>
                        <Text style={styles.detailMediaActionText}>Choose another</Text>
                      </Pressable>
                    </View>
                    {resubmissionAsset ? (
                      <Text style={styles.detailBody}>
                        Replacement selected: {resubmissionAsset.name}
                      </Text>
                    ) : null}
                    <TextInput
                      multiline
                      blurOnSubmit
                      enablesReturnKeyAutomatically
                      returnKeyType="send"
                      style={styles.detailResubmitInput}
                      value={resubmissionText}
                      onChangeText={setResubmissionText}
                      onSubmitEditing={() => {
                        if (!resubmittingDetail && resubmissionText.trim()) {
                          resubmitSelectedSubmission();
                        }
                      }}
                      placeholder="Add the missing detail here."
                      placeholderTextColor="#8f908c"
                    />
                    <Pressable
                      disabled={resubmittingDetail || !resubmissionText.trim()}
                      style={[
                        styles.detailResubmitButton,
                        (resubmittingDetail || !resubmissionText.trim()) && styles.buttonDisabled
                      ]}
                      onPress={resubmitSelectedSubmission}
                    >
                      {resubmittingDetail ? (
                        <ActivityIndicator color="#fffdf8" />
                      ) : (
                        <Text style={styles.detailResubmitButtonText}>Fix and resubmit</Text>
                      )}
                    </Pressable>
                  </>
                ) : null}

                {selectedSubmissionDetail.publishedPost ? (
                  <View style={styles.publishedDetailCard}>
                    <View style={styles.publishedDetailHeader}>
                      <View>
                        <Text style={styles.publishedDetailKicker}>Published post</Text>
                        <Text style={styles.publishedDetailTitle}>Ready for families</Text>
                      </View>
                      <View style={[styles.statusBadge, styles.statusBadgeSuccess]}>
                        <Text style={[styles.statusBadgeText, styles.statusBadgeTextSuccess]}>Live</Text>
                      </View>
                    </View>
                    <Text style={styles.publishedCaption}>
                      {selectedSubmissionDetail.caption_draft?.trim() ||
                        selectedSubmissionDetail.raw_text?.trim() ||
                        "No caption provided"}
                    </Text>
                    <View style={styles.publishedMetaGrid}>
                      <View style={styles.publishedMetaItem}>
                        <Text style={styles.publishedMetaLabel}>Destination</Text>
                        <Text style={styles.publishedMetaValue}>
                          {selectedSubmissionDetail.publishedPost.destinationName}
                        </Text>
                      </View>
                      <View style={styles.publishedMetaItem}>
                        <Text style={styles.publishedMetaLabel}>Published</Text>
                        <Text style={styles.publishedMetaValue}>
                          {formatSubmittedAt(selectedSubmissionDetail.publishedPost.publishedAt)}
                        </Text>
                      </View>
                    </View>
                    {selectedSubmissionDetail.routing_decision ? (
                      <View style={styles.metaChipRow}>
                        <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>
                            Route: {formatRoutingSourceLabel(selectedSubmissionDetail.routing_decision.routingSource)}
                          </Text>
                        </View>
                        <View style={styles.metaChip}>
                          <Text style={styles.metaChipText}>
                            Approver: {formatApprovalRoleLabel(selectedSubmissionDetail.latestApprovalRequest?.approverRole)}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                    <View style={styles.publishedActionRow}>
                      <Pressable
                        style={styles.publishedPrimaryButton}
                        onPress={() => sharePublishedSubmission(selectedSubmissionDetail)}
                      >
                        <Text style={styles.publishedPrimaryButtonText}>Share post</Text>
                      </Pressable>
                      <Pressable
                        style={styles.publishedSecondaryButton}
                        onPress={() => {
                          setSelectedSubmissionId(null);
                          setSelectedSubmissionDetail(null);
                          setActiveView("feed");
                        }}
                      >
                        <Text style={styles.publishedSecondaryButtonText}>Open feed</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </ScrollView>
            )}
          </View>
        </View>
        </Modal>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#e8e6f6"
  },
  screen: {
    flex: 1,
    backgroundColor: "#ece9f9",
    position: "relative"
  },
  screenGradient: {
    ...StyleSheet.absoluteFillObject
  },
  glassFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 30
  },
  glassFillSoft: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.16)"
  },
  backgroundGlowA: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(111, 203, 255, 0.24)",
    top: 84,
    right: -48
  },
  backgroundGlowB: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(246, 160, 255, 0.20)",
    top: 180,
    left: -54
  },
  backgroundGlowC: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: "rgba(255, 255, 255, 0.40)",
    bottom: -70,
    right: 18
  },
  chromeBar: {
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
    color: "#2b2451",
    fontWeight: "800"
  },
  appSubtitle: {
    fontSize: 13,
    color: "#756fa0"
  },
  settingsButton: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)"
  },
  settingsButtonText: {
    color: "#352c68",
    fontWeight: "800"
  },
  segmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 10
  },
  segmentButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.40)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.55)"
  },
  segmentButtonActive: {
    backgroundColor: "rgba(71, 62, 153, 0.86)",
    borderColor: "rgba(255,255,255,0.16)"
  },
  segmentText: {
    color: "#43378e",
    fontWeight: "800"
  },
  segmentTextActive: {
    color: "#f8f7ff"
  },
  container: {
    paddingHorizontal: 20,
    paddingBottom: 28,
    gap: 18
  },
  containerWithKeyboardBuffer: {
    paddingBottom: 180
  },
  captureStage: {
    overflow: "hidden",
    backgroundColor: "rgba(255,255,255,0.34)",
    borderRadius: 34,
    padding: 22,
    gap: 18,
    position: "relative",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.52)",
    shadowColor: "#8074c7",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
    position: "relative"
  },
  captureGlowOne: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(111, 224, 255, 0.30)",
    top: -40,
    right: -20
  },
  captureGlowTwo: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(247, 173, 255, 0.28)",
    bottom: -60,
    left: -30
  },
  captureKicker: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#8178b2",
    fontWeight: "800"
  },
  captureTitle: {
    fontSize: 34,
    lineHeight: 37,
    color: "#2a2451",
    fontWeight: "800"
  },
  captureBody: {
    fontSize: 16,
    lineHeight: 24,
    color: "#5d5a80",
    maxWidth: 300
  },
  captureActionStack: {
    gap: 12
  },
  primaryCaptureButton: {
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.70)",
    paddingVertical: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.74)"
  },
  primaryCaptureButtonText: {
    color: "#342c68",
    fontSize: 17,
    fontWeight: "800"
  },
  secondaryCaptureButton: {
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.22)",
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.38)"
  },
  secondaryCaptureButtonText: {
    color: "#40377f",
    fontWeight: "700"
  },
  captureHintRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10
  },
  captureHint: {
    color: "#615d83",
    fontSize: 13,
    backgroundColor: "rgba(255,255,255,0.32)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    overflow: "hidden"
  },
  previewStage: {
    backgroundColor: "rgba(255,255,255,0.30)",
    borderRadius: 34,
    padding: 0,
    gap: 0,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
    overflow: "hidden",
    shadowColor: "#7e71bf",
    shadowOpacity: 0.18,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
    position: "relative"
  },
  topGhostButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)"
  },
  topGhostButtonText: {
    color: "#43378e",
    fontWeight: "800"
  },
  previewImage: {
    width: "100%",
    height: 560,
    justifyContent: "flex-end",
    backgroundColor: "#d6ddd7"
  },
  previewImageMedia: {
    borderRadius: 28
  },
  previewImageShade: {
    flex: 1,
    justifyContent: "space-between",
    padding: 18
  },
  videoPreviewStage: {
    minHeight: 520,
    borderRadius: 34,
    backgroundColor: "#8d86c7",
    justifyContent: "flex-end",
    overflow: "hidden"
  },
  previewTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  previewEyebrow: {
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#d9d4ff",
    fontWeight: "800"
  },
  previewHeroTitle: {
    marginTop: 4,
    fontSize: 30,
    lineHeight: 32,
    color: "#f7f6ff",
    fontWeight: "800"
  },
  previewTopButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)"
  },
  previewTopButtonText: {
    color: "#fcfbff",
    fontWeight: "800"
  },
  previewBottomStack: {
    gap: 12
  },
  previewMediaOverlay: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 24,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.26)"
  },
  previewChipRow: {
    flexDirection: "row",
    gap: 8
  },
  previewChip: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.44)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.48)"
  },
  previewChipText: {
    color: "#f8f7ff",
    fontWeight: "800",
    fontSize: 12
  },
  previewAssetName: {
    color: "#f8f7ff",
    fontSize: 24,
    lineHeight: 27,
    fontWeight: "800"
  },
  previewOverlayHint: {
    color: "#efeefe",
    lineHeight: 20
  },
  videoPreviewName: {
    color: "#fcfbff",
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800"
  },
  videoPreviewCopy: {
    color: "#eeeafe",
    lineHeight: 22
  },
  composerSheet: {
    borderRadius: 30,
    backgroundColor: "rgba(255,255,255,0.56)",
    padding: 18,
    gap: 12,
    marginTop: -34,
    marginHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.68)",
    position: "relative",
    overflow: "hidden"
  },
  sheetHandle: {
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(118, 110, 176, 0.38)",
    alignSelf: "center",
    marginBottom: 2
  },
  sheetTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start"
  },
  sheetLabel: {
    color: "#8278b0",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.3
  },
  sheetTitle: {
    marginTop: 4,
    color: "#2a2451",
    fontSize: 20,
    lineHeight: 23,
    fontWeight: "800",
    maxWidth: 220
  },
  inlineMetaPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.48)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)"
  },
  inlineMetaPillText: {
    color: "#5e5895",
    fontWeight: "800",
    fontSize: 12
  },
  audienceRow: {
    flexDirection: "row",
    gap: 10
  },
  audiencePill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.42)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)"
  },
  audiencePillActive: {
    backgroundColor: "rgba(82, 71, 173, 0.88)",
    borderColor: "rgba(255,255,255,0.16)"
  },
  audiencePillText: {
    color: "#60578f",
    fontWeight: "800"
  },
  audiencePillTextActive: {
    color: "#f8f7ff"
  },
  captionInput: {
    minHeight: 108,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "rgba(255,255,255,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.66)",
    color: "#2a2451",
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 22
  },
  submitRow: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch"
  },
  inlineButton: {
    flex: 1,
    minHeight: 76,
    paddingHorizontal: 12,
    paddingVertical: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.44)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)",
    alignItems: "center",
    justifyContent: "center"
  },
  inlineButtonText: {
    color: "#5e5894",
    fontSize: 15,
    fontWeight: "800",
    lineHeight: 19,
    textAlign: "center"
  },
  submitButton: {
    flex: 1,
    minHeight: 76,
    borderRadius: 22,
    backgroundColor: "#6d63cf",
    paddingHorizontal: 12,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center"
  },
  submitButtonText: {
    color: "#f8f7ff",
    fontSize: 16,
    fontWeight: "800",
    lineHeight: 20,
    textAlign: "center"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  miniStatusCard: {
    backgroundColor: "rgba(255,255,255,0.38)",
    borderRadius: 26,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.56)",
    gap: 8,
    position: "relative",
    overflow: "hidden"
  },
  miniStatusKicker: {
    fontSize: 12,
    letterSpacing: 1.3,
    textTransform: "uppercase",
    color: "#8178b1",
    fontWeight: "800"
  },
  miniStatusTitle: {
    fontSize: 22,
    lineHeight: 25,
    color: "#2a2451",
    fontWeight: "800"
  },
  miniStatusBody: {
    color: "#666286",
    lineHeight: 21
  },
  inlineStatusActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14
  },
  inlineStatusLink: {
    alignSelf: "flex-start",
    marginTop: 4
  },
  inlineStatusLinkText: {
    color: "#5b52ba",
    fontWeight: "800"
  },
  statusHeroCard: {
    backgroundColor: "rgba(255,255,255,0.32)",
    borderRadius: 30,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
    shadowColor: "#8074c7",
    shadowOpacity: 0.16,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
    position: "relative",
    overflow: "hidden"
  },
  statusHeroKicker: {
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: "#7f77ae",
    fontWeight: "800"
  },
  statusHeroTitle: {
    fontSize: 30,
    lineHeight: 33,
    color: "#2a2451",
    fontWeight: "800"
  },
  statusHeroBody: {
    color: "#5d5a82",
    lineHeight: 22
  },
  statusSummaryRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap"
  },
  statusSummaryPill: {
    minWidth: 94,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.36)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
    justifyContent: "center"
  },
  statusSummaryValue: {
    color: "#2c2452",
    fontSize: 22,
    fontWeight: "800"
  },
  statusSummaryLabel: {
    color: "#7168a2",
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 1.1,
    marginTop: 4
  },
  reviewQueueHint: {
    color: "#5d5a80",
    lineHeight: 20,
    marginTop: 2
  },
  reviewerPublishedCard: {
    backgroundColor: "rgba(255,255,255,0.48)",
    borderRadius: 26,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.66)",
    position: "relative",
    overflow: "hidden"
  },
  sectionBlock: {
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
    color: "#8078af",
    fontWeight: "800"
  },
  sectionTitle: {
    fontSize: 26,
    lineHeight: 28,
    color: "#2a2451",
    fontWeight: "800"
  },
  feedCheckPanel: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.46)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)"
  },
  feedCheckLabel: {
    color: "#8078af",
    fontSize: 11,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    fontWeight: "800"
  },
  feedCheckValue: {
    color: "#2a2451",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "900",
    marginTop: 3
  },
  feedCheckBadge: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.48)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)"
  },
  feedCheckBadgeText: {
    color: "#5b52ba",
    fontSize: 12,
    fontWeight: "900"
  },
  feedCheckReady: {
    color: "#226d56",
    fontSize: 12,
    fontWeight: "900",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(204, 255, 228, 0.64)",
    overflow: "hidden"
  },
  unreadBadge: {
    color: "#5b52ba",
    fontWeight: "800"
  },
  latestPostCard: {
    backgroundColor: "rgba(255,255,255,0.44)",
    borderRadius: 30,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)",
    gap: 12,
    shadowColor: "#776db8",
    shadowOpacity: 0.14,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 4,
    position: "relative",
    overflow: "hidden"
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
    backgroundColor: "rgba(255,255,255,0.36)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.48)"
  },
  statusBadgeSuccess: { backgroundColor: "rgba(204, 255, 228, 0.64)" },
  statusBadgeAttention: { backgroundColor: "rgba(255, 214, 225, 0.72)" },
  statusBadgeInfo: { backgroundColor: "rgba(211, 234, 255, 0.72)" },
  statusBadgeText: {
    color: "#5d5889",
    fontWeight: "800",
    fontSize: 12
  },
  statusBadgeTextSuccess: { color: "#226d56" },
  statusBadgeTextAttention: { color: "#9f4764" },
  statusBadgeTextInfo: { color: "#3b5ea3" },
  feedTime: {
    color: "#7b76a3",
    fontSize: 12,
    flexShrink: 1,
    textAlign: "right"
  },
  feedHeadline: {
    fontSize: 20,
    lineHeight: 24,
    color: "#2a2451",
    fontWeight: "800"
  },
  feedSupport: {
    color: "#656185",
    lineHeight: 21
  },
  feedPublishedHint: {
    color: "#5b52ba",
    fontWeight: "800",
    lineHeight: 20
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
    backgroundColor: "rgba(255,255,255,0.42)",
    alignItems: "center",
    justifyContent: "center"
  },
  progressDotComplete: { backgroundColor: "#6d63cf" },
  progressDotCurrent: { backgroundColor: "#ff8ccf" },
  progressDotText: {
    color: "#7c75a7",
    fontWeight: "800",
    fontSize: 12
  },
  progressDotTextActive: { color: "#f8f7ff" },
  progressLabel: {
    color: "#8983b0",
    fontSize: 11,
    fontWeight: "700"
  },
  progressLabelActive: { color: "#2a2451" },
  metaChipRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  metaChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.38)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)"
  },
  metaChipText: {
    color: "#625a92",
    fontWeight: "800",
    fontSize: 12
  },
  feedCard: {
    backgroundColor: "rgba(255,255,255,0.40)",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.56)",
    gap: 10,
    position: "relative",
    overflow: "hidden"
  },
  feedCardFeatured: {
    backgroundColor: "rgba(255,255,255,0.52)"
  },
  clubFeedMediaFrame: {
    width: "100%",
    aspectRatio: 1.45,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(55, 48, 108, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.48)"
  },
  clubFeedImage: {
    width: "100%",
    height: "100%"
  },
  clubFeedImageFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 18,
    backgroundColor: "rgba(50, 43, 95, 0.84)"
  },
  clubFeedImageFallbackTitle: {
    color: "#fffdf8",
    fontSize: 15,
    fontWeight: "900"
  },
  clubFeedImageFallbackCopy: {
    color: "rgba(255, 253, 248, 0.82)",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center"
  },
  clubFeedVideoPreview: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(50, 43, 95, 0.78)"
  },
  clubFeedVideoText: {
    color: "#fffdf8",
    fontWeight: "900",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  notificationCard: {
    backgroundColor: "rgba(255,255,255,0.40)",
    borderRadius: 24,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.56)",
    gap: 10,
    position: "relative",
    overflow: "hidden"
  },
  notificationCardUnread: {
    borderColor: "rgba(100, 90, 214, 0.58)",
    backgroundColor: "rgba(255,255,255,0.56)"
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
    backgroundColor: "#6d63cf"
  },
  notificationTitle: {
    color: "#2a2451",
    fontWeight: "800",
    flexShrink: 1
  },
  notificationBody: {
    color: "#625f83",
    lineHeight: 21
  },
  notificationMeta: {
    color: "#7d79a2",
    fontSize: 12
  },
  pushRegistrationStatus: {
    color: "#625a92",
    fontSize: 12,
    fontWeight: "800",
    marginTop: -2
  },
  emptyStateText: {
    color: "#666186",
    lineHeight: 21
  },
  errorStateText: {
    color: "#9f4764",
    lineHeight: 21
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(42,36,81,0.28)",
    justifyContent: "flex-end"
  },
  modalCard: {
    maxHeight: "88%",
    backgroundColor: "rgba(248,247,255,0.94)",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    padding: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    overflow: "hidden",
    position: "relative"
  },
  closeButtonText: {
    color: "#5b52ba",
    fontWeight: "800",
    fontSize: 16
  },
  settingsCard: {
    backgroundColor: "rgba(255,255,255,0.48)",
    borderRadius: 22,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
    overflow: "hidden",
    position: "relative"
  },
  settingsScroll: {
    flexGrow: 0
  },
  settingsScrollContent: {
    gap: 12,
    paddingBottom: 12
  },
  settingsLabel: {
    color: "#7369a2",
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  buildInfoHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  buildInfoTitle: {
    color: "#2a2451",
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "800",
    marginTop: 4
  },
  buildInfoGrid: {
    gap: 8
  },
  buildInfoRow: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(244,242,255,0.66)",
    borderWidth: 1,
    borderColor: "rgba(91,82,186,0.10)",
    gap: 4
  },
  buildInfoLabel: {
    color: "#756fa0",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  buildInfoValue: {
    color: "#2a2451",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "700"
  },
  advancedToggle: {
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.40)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.56)"
  },
  advancedToggleTitle: {
    color: "#2a2451",
    fontWeight: "800"
  },
  advancedToggleCopy: {
    color: "#676287",
    marginTop: 6,
    lineHeight: 20
  },
  advancedHelpText: {
    color: "#6a6686",
    lineHeight: 20
  },
  settingsStackTop: {
    marginTop: 4
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
    backgroundColor: "rgba(255,255,255,0.58)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#2a2451"
  },
  detailHero: {
    backgroundColor: "#f1e8da",
    borderRadius: 22,
    padding: 16,
    gap: 8
  },
  detailStatus: {
    color: "#176744",
    fontWeight: "800"
  },
  detailSummary: {
    color: "#11261f",
    fontSize: 22,
    lineHeight: 26,
    fontWeight: "800"
  },
  detailMeta: {
    color: "#6d6f6d"
  },
  detailMediaCard: {
    marginTop: 14,
    backgroundColor: "rgba(255,255,255,0.66)",
    borderRadius: 22,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    gap: 10
  },
  detailMediaPreview: {
    width: "100%",
    height: 260,
    borderRadius: 18,
    backgroundColor: "#e8e1d8"
  },
  detailMediaFallback: {
    minHeight: 180,
    borderRadius: 18,
    backgroundColor: "#ece7f8",
    padding: 18,
    justifyContent: "center",
    gap: 8
  },
  detailMediaFallbackLabel: {
    color: "#574da8",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.1
  },
  detailMediaFallbackBody: {
    color: "#5d5a82",
    lineHeight: 21
  },
  detailMediaMetaRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap"
  },
  detailHeading: {
    marginTop: 16,
    marginBottom: 6,
    color: "#11261f",
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
  },
  publishedDetailCard: {
    marginTop: 16,
    borderRadius: 22,
    padding: 16,
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.74)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.82)"
  },
  publishedDetailHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12
  },
  publishedDetailKicker: {
    color: "#6f66a3",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.1,
    textTransform: "uppercase"
  },
  publishedDetailTitle: {
    color: "#11261f",
    fontSize: 20,
    lineHeight: 23,
    fontWeight: "800",
    marginTop: 3
  },
  publishedCaption: {
    color: "#2a2451",
    fontSize: 18,
    lineHeight: 23,
    fontWeight: "800"
  },
  publishedMetaGrid: {
    gap: 10
  },
  publishedMetaItem: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(244,242,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(91,82,186,0.10)"
  },
  publishedMetaLabel: {
    color: "#756fa0",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  publishedMetaValue: {
    color: "#2a2451",
    fontWeight: "800",
    marginTop: 4,
    lineHeight: 20
  },
  publishedActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 2
  },
  publishedPrimaryButton: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "#6d63cf",
    alignItems: "center"
  },
  publishedPrimaryButtonText: {
    color: "#f8f7ff",
    fontWeight: "800"
  },
  publishedSecondaryButton: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(91, 82, 186, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(91, 82, 186, 0.18)",
    alignItems: "center"
  },
  publishedSecondaryButtonText: {
    color: "#4f46a6",
    fontWeight: "800"
  },
  detailSupportCallout: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "rgba(88, 99, 185, 0.10)",
    color: "#4d4f87",
    lineHeight: 20
  },
  detailShortcutRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 10
  },
  detailShortcutButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.85)",
    borderWidth: 1,
    borderColor: "rgba(88, 99, 185, 0.16)"
  },
  detailShortcutText: {
    color: "#4f46a6",
    fontWeight: "700"
  },
  detailResubmitInput: {
    minHeight: 108,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(170, 179, 198, 0.38)",
    color: "#213040",
    textAlignVertical: "top",
    marginTop: 10
  },
  detailMediaActionRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 10
  },
  detailMediaActionButton: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: "rgba(91, 82, 186, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(91, 82, 186, 0.20)"
  },
  detailMediaActionText: {
    color: "#4f46a6",
    fontWeight: "700"
  },
  reviewActionPanel: {
    backgroundColor: "rgba(255,255,255,0.60)",
    borderRadius: 22,
    padding: 14,
    marginTop: 10,
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.74)"
  },
  reviewActionTitle: {
    color: "#2a2451",
    fontWeight: "800",
    fontSize: 18,
    lineHeight: 22
  },
  reviewReasonSection: {
    gap: 10
  },
  reviewActionLabel: {
    color: "#675f90",
    fontWeight: "700"
  },
  reviewShortcutActive: {
    backgroundColor: "rgba(91, 82, 186, 0.16)",
    borderColor: "rgba(91, 82, 186, 0.26)"
  },
  reviewNoteCard: {
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.80)",
    padding: 14,
    gap: 8
  },
  reviewNoteTitle: {
    color: "#2a2451",
    fontWeight: "800",
    fontSize: 15
  },
  reviewNoteBody: {
    color: "#5f5b81",
    lineHeight: 20
  },
  reviewActionButtonActive: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
    transform: [{ translateY: -1 }]
  },
  reviewActionButtonApprove: {
    backgroundColor: "rgba(205, 246, 224, 0.80)",
    borderColor: "rgba(112, 204, 160, 0.36)"
  },
  reviewActionButtonChanges: {
    backgroundColor: "rgba(255, 230, 195, 0.84)",
    borderColor: "rgba(214, 154, 58, 0.34)"
  },
  reviewActionButtonReject: {
    backgroundColor: "rgba(255, 210, 219, 0.82)",
    borderColor: "rgba(196, 94, 122, 0.36)"
  },
  reviewActionButtonTextActive: {
    color: "#213040"
  },
  reviewActionButtonTextApprove: {
    color: "#176744"
  },
  reviewActionButtonTextChanges: {
    color: "#8c5a16"
  },
  reviewActionButtonTextReject: {
    color: "#9f4764"
  },
  reviewActionApproveButton: {
    backgroundColor: "#176744"
  },
  reviewActionChangesButton: {
    backgroundColor: "#8c5a16"
  },
  reviewActionRejectButton: {
    backgroundColor: "#9f4764"
  },
  reviewActionStatus: {
    color: "#5f5b81",
    lineHeight: 20,
    marginTop: 2
  },
  detailResubmitButton: {
    marginTop: 12,
    alignSelf: "flex-start",
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: "#2037a5",
    minWidth: 160,
    alignItems: "center",
    justifyContent: "center"
  },
  detailResubmitButtonText: {
    color: "#fffdf8",
    fontSize: 15,
    fontWeight: "700"
  }
});
