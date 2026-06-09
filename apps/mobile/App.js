import * as FileSystem from "expo-file-system";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ImageBackground,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  buildSubmissionRequestBody,
  buildSubmissionText
} from "../../packages/shared/src/submission-serialization.js";

const defaultConfig = {
  apiBaseUrl:
    process.env.EXPO_PUBLIC_API_BASE_URL || "https://clubcontent-api.davmn.net",
  clubSlug: process.env.EXPO_PUBLIC_CLUB_SLUG || "demo-workspace",
  teamSlug: process.env.EXPO_PUBLIC_TEAM_SLUG || "content-team",
  submitterEmail:
    process.env.EXPO_PUBLIC_SUBMITTER_EMAIL || "submitter@demo-workspace.local",
  reviewerEmail:
    process.env.EXPO_PUBLIC_REVIEWER_EMAIL ||
    process.env.EXPO_PUBLIC_DEMO_REVIEWER_EMAIL ||
    "review@demo-workspace.local",
  workspaceMode: process.env.EXPO_PUBLIC_WORKSPACE_MODE || "poster"
};

const progressStages = [
  { key: "submitted", label: "Received" },
  { key: "needs_human_review", label: "Review" },
  { key: "approved", label: "Approved" },
  { key: "published", label: "Posted" }
];

let imagePickerModulePromise;

function loadImagePickerModule() {
  if (!imagePickerModulePromise) {
    imagePickerModulePromise = import("expo-image-picker");
  }

  return imagePickerModulePromise;
}

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
  if (normalized === "needs_human_review") return "info";
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
  if (status === "published") return "Approved and shared to the primary feed.";
  if (status === "approved") return "Approved and waiting for publishing.";
  if (status === "rejected") return "Stopped in review.";
  if (status === "changes_requested" || status === "needs_metadata") {
    return "Needs an update before it can move forward.";
  }
  if (status === "needs_human_review") return "A reviewer is looking at it now.";
  return "Captured and waiting to enter review.";
}

function extractSubmissionField(rawText, label) {
  const value = String(rawText || "");
  const escapedLabel = String(label || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = value.match(new RegExp(`^${escapedLabel}:\\s*(.+)$`, "im"));
  return match ? match[1].trim() : "";
}

function formatSubmissionHeadline(rawText) {
  const headline = String(rawText || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^[A-Za-z ]+:\s/.test(line));
  return headline || "No caption provided";
}

function buildSubmissionQuickChips(item) {
  const rawText = String(item?.raw_text || "");
  return [
    item?.team_name || formatContentTypeLabel(item?.content_type),
    extractSubmissionField(rawText, "Event"),
    extractSubmissionField(rawText, "Channels")
      .split(",")
      .map((channel) => channel.trim())
      .filter(Boolean)[0],
    formatRiskScoreLabel(item?.risk_score)
  ].filter(Boolean);
}

function buildNotificationBody(item) {
  if (item?.payload?.notes) return item.payload.notes;
  if (item?.payload?.summary) return item.payload.summary;
  if (item?.type === "submission_published") {
    return `Published to ${item.payload?.destinationType || "the primary feed"}.`;
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
        body: "Keep it short and brand-ready. A cleaner caption should be enough here."
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
        { label: "Swap media", mediaAction: "library" }
      ];
    default:
      return [];
  }
}

const reviewQueuePreviewItems = [
  {
    id: "preview-review-1",
    submission_id: "0831d781-00b5-4a5c-b81d-349f2ca466a6",
    state: "pending",
    created_at: "2026-05-26T14:43:42.879Z",
    submission_status: "needs_human_review",
    raw_text: "Fresh photo upload to verify the live reviewer preview.",
    risk_score: "0.10",
    approver_name: "Review Lead",
    latest_review_summary: "Low-risk submission. Safe to route for standard internal approval.",
    content_type: "photo",
    team_name: "Content Team"
  },
  {
    id: "preview-review-2",
    submission_id: "95ee662c-6b8b-4276-b776-b492618a6124",
    state: "pending",
    created_at: "2026-05-26T15:42:58.018Z",
    submission_status: "needs_human_review",
    raw_text: "Mia scored twice in a 3-1 win over Lakeville North.",
    risk_score: "0.10",
    approver_name: "Review Lead",
    latest_review_summary: "Low-risk submission. Safe to route for standard internal approval.",
    content_type: "photo",
    team_name: "Content Team"
  }
];

const socialChannelOptions = [
  { key: "instagram", label: "Instagram", favorite: true },
  { key: "facebook", label: "Facebook", favorite: true },
  { key: "team-feed", label: "Team Feed", favorite: true },
  { key: "website", label: "Website", favorite: false },
  { key: "newsletter", label: "Newsletter", favorite: false },
  { key: "x", label: "X", favorite: false },
  { key: "tiktok", label: "TikTok", favorite: false }
];

const webReviewPreviewSubmissionIds = new Set(
  reviewQueuePreviewItems.map((item) => item.submission_id)
);

function isWebReviewPreviewSubmission(submissionId) {
  return Platform.OS === "web" && webReviewPreviewSubmissionIds.has(submissionId);
}

function createPreviewPosterDataUrl(title, subtitle, tone = "#9f8cff") {
  const safeTitle = String(title || "Preview")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const safeSubtitle = String(subtitle || "Content Studio")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1400" height="1000" viewBox="0 0 1400 1000">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#f7f4ff"/>
          <stop offset="48%" stop-color="#dbeeff"/>
          <stop offset="100%" stop-color="#d6cdfa"/>
        </linearGradient>
        <radialGradient id="glow" cx="20%" cy="20%" r="70%">
          <stop offset="0%" stop-color="${tone}" stop-opacity="0.75"/>
          <stop offset="100%" stop-color="${tone}" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect width="1400" height="1000" fill="url(#bg)"/>
      <circle cx="1100" cy="220" r="210" fill="url(#glow)"/>
      <circle cx="220" cy="760" r="250" fill="#fff3d9" fill-opacity="0.58"/>
      <rect x="90" y="88" rx="34" ry="34" width="1220" height="824" fill="rgba(18,55,45,0.08)" stroke="rgba(255,255,255,0.72)" stroke-width="3"/>
      <rect x="150" y="150" rx="28" ry="28" width="360" height="64" fill="rgba(255,255,255,0.56)"/>
      <rect x="150" y="248" rx="30" ry="30" width="620" height="430" fill="rgba(255,255,255,0.74)"/>
      <rect x="810" y="248" rx="30" ry="30" width="340" height="430" fill="rgba(255,255,255,0.56)"/>
      <rect x="150" y="736" rx="24" ry="24" width="1000" height="70" fill="rgba(255,255,255,0.44)"/>
      <text x="162" y="194" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#1d2a46">Content preview</text>
      <text x="175" y="334" font-family="Inter, Arial, sans-serif" font-size="48" font-weight="800" fill="#1d2342">${safeTitle}</text>
      <text x="175" y="392" font-family="Inter, Arial, sans-serif" font-size="26" font-weight="500" fill="#4e5b79">${safeSubtitle}</text>
      <text x="865" y="328" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#1f2f56">Review ready</text>
      <text x="865" y="374" font-family="Inter, Arial, sans-serif" font-size="20" font-weight="500" fill="#5f6b87">Tap approve, send back, or reject.</text>
      <text x="175" y="780" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="700" fill="#31415f">Browser preview only</text>
      <text x="175" y="812" font-family="Inter, Arial, sans-serif" font-size="18" font-weight="500" fill="#5d6a83">The native build will show the real submission media here.</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

function buildWebReviewPreviewDetail(item) {
  if (!item) return null;
  const previewUrl = createPreviewPosterDataUrl(
    item.raw_text || "Fresh review preview",
    item.latest_review_summary || "Browser preview queue item."
  );

  return {
    id: item.submission_id,
    club_slug: "demo-workspace",
    team_slug: "content-team",
    content_type: item.content_type || "photo",
    visibility_target: "internal",
    raw_text: item.raw_text,
    status: item.submission_status || "needs_human_review",
    created_at: item.created_at,
    risk_score: item.risk_score,
    media: [
      {
        objectKey: `preview-${item.submission_id}`,
        previewUrl,
        mediaType: "image",
        mimeType: "image/svg+xml"
      }
    ],
    latestReviewRun: {
      resultStatus: "needs_review",
      agentName: "Browser preview",
      summary: item.latest_review_summary || "Browser preview queue item."
    },
    latestApprovalRequest: {
      id: item.id,
      state: item.state || "pending",
      approverName: item.approver_name || "Review Lead",
      latestAction: null
    }
  };
}

function findWebReviewPreviewItem(submissionId) {
  return reviewQueuePreviewItems.find((item) => item.submission_id === submissionId) || null;
}

function buildDemoWorkflowDetail(submissionId) {
  if (!demoWorkflowAsset || submissionId !== "demo-submission-1") return null;
  const queueItem = demoWorkflowReviewQueue[0];

  return {
    id: "demo-submission-1",
    club_slug: "demo-workspace",
    team_slug: "content-team",
    content_type: "photo",
    visibility_target: "internal",
    raw_text: demoWorkflowSubmissions[0].raw_text,
    status: "needs_human_review",
    created_at: demoWorkflowSubmissions[0].created_at,
    risk_score: queueItem.risk_score,
    media: [
      {
        objectKey: "demo-match-moment",
        previewUrl: demoWorkflowAsset.uri,
        mediaType: "image",
        mimeType: "image/jpeg"
      }
    ],
    latestReviewRun: {
      resultStatus: "needs_review",
      agentName: "Demo review",
      summary: queueItem.latest_review_summary
    },
    latestApprovalRequest: {
      id: queueItem.id,
      state: "pending",
      approverName: queueItem.approver_name,
      latestAction: null
    }
  };
}

function buildQueueFallbackDetail(queueItem, submissionId, currentClubSlug, currentTeamSlug) {
  if (!queueItem) return null;

  return {
    id: submissionId,
    club_slug: currentClubSlug || "demo-workspace",
    team_slug: currentTeamSlug || "content-team",
    content_type: queueItem.content_type || "photo",
    visibility_target: "internal",
    raw_text: queueItem.raw_text || "",
    status: queueItem.submission_status || "needs_human_review",
    created_at: queueItem.created_at || new Date().toISOString(),
    risk_score: queueItem.risk_score || null,
    media: [],
    latestReviewRun: {
      resultStatus: "needs_review",
      agentName: queueItem.approver_name || "Review Lead",
      summary: queueItem.latest_review_summary || "Queued for review."
    },
    latestApprovalRequest: {
      id: queueItem.id || submissionId,
      state: queueItem.state || "pending",
      approverName: queueItem.approver_name || "Review Lead",
      latestAction: null
    }
  };
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
      helper: "Ask for a cleaner caption.",
      text: "Please tighten the caption so it is ready to post."
    }
  ],
  reject: [
    {
      code: "club_guidelines",
      label: "Off guidelines",
      helper: "Use when the post does not fit the publishing standards.",
      text: "This does not fit the posting guidelines."
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

const demoWorkflowAsset =
  process.env.EXPO_PUBLIC_DEMO_WORKFLOW === "1"
    ? {
        uri: "https://images.unsplash.com/photo-1526232761682-d26e03ac148e?auto=format&fit=crop&w=1200&q=80",
        name: "demo-match-moment.jpg",
        mimeType: "image/jpeg",
        type: "image"
      }
    : null;

const demoWorkflowSubmissions = demoWorkflowAsset
  ? [
      {
        id: "demo-submission-1",
        status: "needs_human_review",
        created_at: new Date().toISOString(),
        raw_text:
          "Pregame huddle before kickoff.\nTags: goal, celebration, tournament\nChannels: Instagram, Facebook\nEvent: Game\nOpponent: Lakeville North\nScore: 3-1 win\nLocation: Shakopee Soccer Complex",
        visibility_target: "internal",
        media_count: 1
      }
    ]
  : [];

const demoWorkflowNotifications = demoWorkflowAsset
  ? [
      {
        id: "demo-notification-1",
        type: "submission_review_started",
        createdAt: new Date().toISOString(),
        readAt: null,
        deliveryStatus: "delivered",
        payload: {
          submissionId: "demo-submission-1",
          status: "needs_human_review",
          summary: "Your post is in the review queue."
        }
      }
    ]
  : [];

const demoWorkflowReviewQueue = demoWorkflowAsset
  ? [
      {
        id: "demo-review-1",
        submission_id: "demo-submission-1",
        state: "pending",
        created_at: new Date().toISOString(),
        submission_status: "needs_human_review",
        raw_text: demoWorkflowSubmissions[0].raw_text,
        risk_score: "0.10",
        approver_name: "Review Lead",
        latest_review_summary: "Low-risk submission. Ready for a quick human approval pass.",
        content_type: "photo",
        team_name: "Content Team"
      }
    ]
  : [];

function GlassLayer() {
  return <View pointerEvents="none" style={styles.glassFillSoft} />;
}

export default function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState(defaultConfig.apiBaseUrl);
  const [clubSlug, setClubSlug] = useState(defaultConfig.clubSlug);
  const [teamSlug, setTeamSlug] = useState(defaultConfig.teamSlug);
  const [submitterEmail, setSubmitterEmail] = useState(defaultConfig.submitterEmail);
  const [reviewerEmail, setReviewerEmail] = useState(defaultConfig.reviewerEmail);
  const [workspaceMode, setWorkspaceMode] = useState(defaultConfig.workspaceMode);
  const [caption, setCaption] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [eventTypeInput, setEventTypeInput] = useState("Game");
  const [eventDetailInput, setEventDetailInput] = useState("");
  const [opponentInput, setOpponentInput] = useState("");
  const [scoreInput, setScoreInput] = useState("");
  const [locationInput, setLocationInput] = useState("");
  const [selectedChannels, setSelectedChannels] = useState(["instagram", "facebook"]);
  const [showComposerDetails, setShowComposerDetails] = useState(false);
  const defaultVisibilityTarget = "internal";
  const [asset, setAsset] = useState(demoWorkflowAsset);
  const [status, setStatus] = useState("Take a photo or choose one to get started.");
  const [submitting, setSubmitting] = useState(false);
  const [recentSubmissions, setRecentSubmissions] = useState(demoWorkflowSubmissions);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [recentError, setRecentError] = useState("");
  const [notifications, setNotifications] = useState(demoWorkflowNotifications);
  const [loadingNotifications, setLoadingNotifications] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
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
  const [reviewDetailsExpanded, setReviewDetailsExpanded] = useState(false);
  const [pendingReviewSubmissionId, setPendingReviewSubmissionId] = useState(null);

  const canSubmit = useMemo(() => {
    return Boolean(asset && apiBaseUrl.trim() && clubSlug.trim() && submitterEmail.trim());
  }, [asset, apiBaseUrl, clubSlug, submitterEmail]);

  const canLoadRecent = useMemo(() => {
    return Boolean(apiBaseUrl.trim() && clubSlug.trim() && submitterEmail.trim());
  }, [apiBaseUrl, clubSlug, submitterEmail]);

  const canReview = useMemo(() => {
    return Boolean(apiBaseUrl.trim() && reviewerEmail.trim() && workspaceMode === "reviewer");
  }, [apiBaseUrl, reviewerEmail, workspaceMode]);

  const showReviewTab = workspaceMode === "reviewer";

  useEffect(() => {
    if (eventTypeInput !== "Other" && eventDetailInput) {
      setEventDetailInput("");
    }
  }, [eventTypeInput, eventDetailInput]);

  const unreadNotificationCount = useMemo(() => {
    return notifications.filter((item) => !item.readAt).length;
  }, [notifications]);

  const submissionStats = useMemo(() => countStatuses(recentSubmissions), [recentSubmissions]);
  const latestSubmission = recentSubmissions[0] || null;
  const latestStatusSummary = latestSubmission
    ? summarizeSubmissionProgress(latestSubmission)
    : "Your first post will show review and publish status here.";
  const postDraftText = useMemo(() => {
    return buildSubmissionText(
      caption,
      tagsInput,
      socialChannelOptions
        .filter((channel) => selectedChannels.includes(channel.key))
        .map((channel) => channel.label),
      eventTypeInput,
      eventDetailInput,
      opponentInput,
      scoreInput,
      locationInput
    );
  }, [
    caption,
    tagsInput,
    selectedChannels,
    eventTypeInput,
    eventDetailInput,
    opponentInput,
    scoreInput,
    locationInput
  ]);
  const locationSuggestions = useMemo(() => {
    const locations = new Map();
    recentSubmissions.forEach((item) => {
      const rawText = String(item?.raw_text || "");
      const parsedLocation =
        extractSubmissionField(rawText, "Location") || String(item?.location || "").trim();
      if (!parsedLocation) return;
      locations.set(parsedLocation, (locations.get(parsedLocation) || 0) + 1);
    });
    return [...locations.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([location]) => location);
  }, [recentSubmissions]);
  const resubmitPrompt = useMemo(() => {
    return fixPromptForReasonCode(
      selectedSubmissionDetail?.latestApprovalRequest?.latestAction?.reasonCode
    );
  }, [selectedSubmissionDetail]);
  const resubmitShortcuts = useMemo(() => {
    return resubmitShortcutsForReasonCode(
      selectedSubmissionDetail?.latestApprovalRequest?.latestAction?.reasonCode
    );
  }, [selectedSubmissionDetail]);

  function toggleSelectedChannel(channelKey) {
    setSelectedChannels((current) => {
      if (current.includes(channelKey)) {
        return current.filter((item) => item !== channelKey);
      }
      return [...current, channelKey];
    });
  }

  async function loadRecentSubmissions() {
    if (demoWorkflowSubmissions.length) {
      setRecentSubmissions(demoWorkflowSubmissions);
      setRecentError("");
      return;
    }

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
    if (demoWorkflowNotifications.length) {
      setNotifications(demoWorkflowNotifications);
      setNotificationsError("");
      return;
    }

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
    const demoDetail = buildDemoWorkflowDetail(submissionId);
    if (demoDetail) {
      setSelectedSubmissionDetail(demoDetail);
      setSelectedSubmissionId(submissionId);
      setResubmissionText(demoDetail.raw_text || "");
      setResubmissionAsset(null);
      setStatus("Demo workflow: showing a sample review item.");
      return;
    }

    const previewItem = isWebReviewPreviewSubmission(submissionId)
      ? findWebReviewPreviewItem(submissionId)
      : null;
    if (previewItem) {
      const payload = buildWebReviewPreviewDetail(previewItem);
      setSelectedSubmissionDetail(payload);
      setSelectedSubmissionId(submissionId);
      setResubmissionText(payload.raw_text || "");
      setResubmissionAsset(null);
      setStatus("Browser preview mode: showing a sample review item.");
      return;
    }

    setLoadingDetail(true);
    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const response = await fetch(`${baseUrl}/submissions/${submissionId}`);
      if (!response.ok) throw new Error(`Submission detail failed: ${response.status}`);
      const payload = await response.json();
      setSelectedSubmissionDetail(payload);
      setSelectedSubmissionId(submissionId);
      setResubmissionText(payload.raw_text || "");
      setResubmissionAsset(null);
    } catch (error) {
      const queueItem = reviewQueue.find(
        (item) => item.submission_id === submissionId || item.submissionId === submissionId
      );
      const fallbackDetail = buildQueueFallbackDetail(queueItem, submissionId, clubSlug, teamSlug);
      if (fallbackDetail) {
        setSelectedSubmissionDetail(fallbackDetail);
        setSelectedSubmissionId(submissionId);
        setResubmissionText(fallbackDetail.raw_text || "");
        setResubmissionAsset(null);
        setStatus("Submission detail unavailable. Showing the queue summary instead.");
        return;
      }

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

  async function resubmitSelectedSubmission() {
    if (!selectedSubmissionDetail) return;

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
                mediaType: contentType === "video" ? "video" : "image"
              }
            ]
          })
        });

        if (!signResponse.ok) throw new Error(`Replacement upload signing failed: ${signResponse.status}`);
        const signPayload = await signResponse.json();
        const uploadPlan = signPayload.uploads?.[0];
        if (!uploadPlan) throw new Error("Replacement signing returned no upload plan");

        await uploadSelectedAsset(uploadPlan, resubmissionAsset);
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
            submitterEmail: submitterEmail.trim(),
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
    const ImagePicker = await loadImagePickerModule();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow photo library access to replace this post.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsEditing: false,
      quality: 0.9,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium
    });

    if (result.canceled || !result.assets?.length) return;
    setResubmissionAsset(normalizePickedAsset(result.assets[0]));
  }

  async function captureReplacementWithCamera() {
    const ImagePicker = await loadImagePickerModule();
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
    if (!canLoadRecent) return;
    refreshStatusFeed();
    const intervalId = setInterval(() => {
      refreshStatusFeed();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [canLoadRecent, apiBaseUrl, clubSlug, teamSlug, submitterEmail]);

  useEffect(() => {
    if (!canReview) return;
    loadReviewQueue();
    if (activeView !== "review") return;
    const intervalId = setInterval(() => {
      loadReviewQueue();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [canReview, apiBaseUrl, reviewerEmail, activeView, workspaceMode]);

  useEffect(() => {
    if (showReviewTab) return;
    if (activeView === "review") {
      setActiveView("post");
    }
  }, [activeView, showReviewTab]);

  useEffect(() => {
    if (workspaceMode !== "reviewer" || !pendingReviewSubmissionId) return;

    const demoDetail = buildDemoWorkflowDetail(pendingReviewSubmissionId);
    const queueItem = reviewQueue.find(
      (item) => item.submission_id === pendingReviewSubmissionId || item.submissionId === pendingReviewSubmissionId
    );
    const fallbackDetail =
      demoDetail ||
      buildQueueFallbackDetail(queueItem, pendingReviewSubmissionId, clubSlug, teamSlug);

    if (!fallbackDetail) return;

    setSelectedSubmissionDetail(fallbackDetail);
    setSelectedSubmissionId(pendingReviewSubmissionId);
    setResubmissionText(fallbackDetail.raw_text || "");
    setResubmissionAsset(null);
    setStatus("Showing the review queue summary.");
    setPendingReviewSubmissionId(null);
  }, [clubSlug, pendingReviewSubmissionId, reviewQueue, teamSlug, workspaceMode]);

  useEffect(() => {
    let mounted = true;

    const applyRouteFromUrl = (incomingUrl) => {
      if (!incomingUrl) return;
      try {
        const parsedUrl = new URL(incomingUrl);
        const candidateView =
          parsedUrl.searchParams.get("view") ||
          parsedUrl.hostname ||
          parsedUrl.pathname.replace(/^\/+/, "");
        const normalizedView = String(candidateView || "").toLowerCase();
        if (["post", "review", "status"].includes(normalizedView)) {
          setActiveView(normalizedView);
        }

        const candidateMode =
          parsedUrl.searchParams.get("mode") ||
          parsedUrl.searchParams.get("workspace") ||
          parsedUrl.searchParams.get("workspaceMode");
        const normalizedMode = String(candidateMode || "").toLowerCase();
        if (["poster", "reviewer"].includes(normalizedMode)) {
          setWorkspaceMode(normalizedMode);
        }

        const submissionId = parsedUrl.searchParams.get("submissionId");
        if (submissionId && normalizedView === "review") {
          setPendingReviewSubmissionId(submissionId);
          setActiveView("review");
        }
      } catch {
        const viewMatch = String(incomingUrl || "").match(/view=([a-z]+)/i);
        const candidateView = viewMatch?.[1] || "";
        const normalizedView = candidateView.toLowerCase();
        if (["post", "review", "status"].includes(normalizedView)) {
          setActiveView(normalizedView);
        }

        const modeMatch = String(incomingUrl || "").match(/(?:mode|workspace|workspaceMode)=([a-z]+)/i);
        const candidateMode = modeMatch?.[1] || "";
        const normalizedMode = candidateMode.toLowerCase();
        if (["poster", "reviewer"].includes(normalizedMode)) {
          setWorkspaceMode(normalizedMode);
        }

        const submissionMatch = String(incomingUrl || "").match(/submissionId=([^&]+)/i);
        const submissionId = submissionMatch?.[1] ? decodeURIComponent(submissionMatch[1]) : "";
        if (submissionId && normalizedView === "review") {
          setPendingReviewSubmissionId(submissionId);
          setActiveView("review");
        }
      }
    };

    Linking.getInitialURL().then((incomingUrl) => {
      if (!mounted) return;
      applyRouteFromUrl(incomingUrl);
    });

    const subscription = Linking.addEventListener("url", (event) => {
      applyRouteFromUrl(event?.url);
    });

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  async function loadReviewQueue() {
    if (demoWorkflowReviewQueue.length) {
      setReviewQueue(demoWorkflowReviewQueue);
      setReviewQueueError("");
      return demoWorkflowReviewQueue;
    }

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
      const previewQueue = reviewQueuePreviewItems.length
        ? reviewQueuePreviewItems
        : demoWorkflowReviewQueue;

      if (previewQueue.length) {
        setReviewQueue(previewQueue);
        setReviewQueueError("");
        setStatus(
          Platform.OS === "web"
            ? "Browser preview mode: showing a sample review queue."
            : "Review API unavailable; showing the local preview queue."
        );
        return previewQueue;
      }

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
    setReviewDetailsExpanded(false);
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

  function openReviewItem(submissionId) {
    const demoDetail = buildDemoWorkflowDetail(submissionId);
    const queueItem = reviewQueue.find(
      (item) => item.submission_id === submissionId || item.submissionId === submissionId
    );
    const fallbackDetail = demoDetail || buildQueueFallbackDetail(queueItem, submissionId, clubSlug, teamSlug);

    setActiveView("review");
    resetReviewActionState();

    if (fallbackDetail) {
      setSelectedSubmissionDetail(fallbackDetail);
      setSelectedSubmissionId(submissionId);
      setResubmissionText(fallbackDetail.raw_text || "");
      setResubmissionAsset(null);
      setStatus("Showing the review queue summary.");
      setPendingReviewSubmissionId(null);
      return;
    }

    setPendingReviewSubmissionId(submissionId);
  }

  async function submitReviewAction() {
    const approvalRequestId = selectedSubmissionDetail?.latestApprovalRequest?.id;
    if (!approvalRequestId) return;

    if (reviewAction !== "approve" && !reviewActionNotes.trim()) {
      Alert.alert("Note required", "Add a short note before you send this back or reject it.");
      return;
    }

    if (isWebReviewPreviewSubmission(selectedSubmissionDetail?.id)) {
      setReviewActionStatus("Browser preview mode. Actions are disabled here.");
      Alert.alert("Preview only", "This browser view is for layout inspection. Use the native app or an on-device build for real review actions.");
      return;
    }

    setReviewActionInProgress(true);
    try {
      const baseUrl = normalizeApiBaseUrl(apiBaseUrl.trim());
      const actionLabel =
        reviewAction === "approve"
          ? "Approved"
          : reviewAction === "request_changes"
            ? "Sent back for changes"
            : "Rejected";

      const response = await fetch(baseUrl + "/approval-requests/" + approvalRequestId + "/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: reviewAction,
          actedByEmail: reviewerEmail.trim(),
          notes: reviewAction === "approve" ? null : reviewActionNotes.trim(),
          reasonCode: reviewActionReasonCode
        })
      });

      if (!response.ok) throw new Error("Review action failed: " + response.status);

      setReviewActionStatus(actionLabel + ". Loading the next item...");
      await refreshStatusFeed();
      const items = await loadReviewQueue();
      const nextItem = items.find((item) => item.submission_id !== selectedSubmissionDetail.id) || items[0] || null;

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
        reviewAction === "approve"
          ? "It is moving forward."
          : reviewAction === "request_changes"
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
    const ImagePicker = await loadImagePickerModule();
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
    const ImagePicker = await loadImagePickerModule();
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission needed", "Allow camera access to capture an update.");
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
    setTagsInput("");
    setEventTypeInput("Game");
    setEventDetailInput("");
    setOpponentInput("");
    setScoreInput("");
    setLocationInput("");
    setSelectedChannels(["instagram", "facebook"]);
    setShowComposerDetails(false);
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

      if (!signResponse.ok) throw new Error(`Upload signing failed: ${signResponse.status}`);
      const signPayload = await signResponse.json();
      const uploadPlan = signPayload.uploads?.[0];
      if (!uploadPlan) throw new Error("Upload signing returned no upload plan");

      setStatus("Uploading media...");
      await uploadSelectedAsset(uploadPlan, asset);

      setStatus("Creating submission...");
      const submissionResponse = await fetch(`${baseUrl}/submissions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          buildSubmissionRequestBody({
          clubSlug,
          teamSlug,
          submitterEmail,
          contentType,
          rawText: postDraftText,
          selectedChannels,
          visibilityTarget: defaultVisibilityTarget,
          objectKey: uploadPlan.objectKey,
          mimeType: asset.mimeType || "application/octet-stream"
          })
        )
      });

      if (!submissionResponse.ok) throw new Error(`Submission failed: ${submissionResponse.status}`);
      const submissionPayload = await submissionResponse.json();
      setStatus(`Submitted ${submissionPayload.submission.id}`);
      setCaption("");
      setTagsInput("");
      setEventTypeInput("Game");
      setEventDetailInput("");
      setOpponentInput("");
      setScoreInput("");
      setLocationInput("");
      setSelectedChannels(["instagram", "facebook"]);
      setShowComposerDetails(false);
      setAsset(null);
      setActiveView("status");
      await refreshStatusFeed();
      Alert.alert("Submitted for review", "Your update is in the workflow now.");
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
      <View style={styles.screen}>
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
            <Text style={styles.appSubtitle}>Post fast. Track clearly.</Text>
          </View>
          <View style={styles.chromeActions}>
            <Pressable
              style={[
                styles.modeToggle,
                workspaceMode === "reviewer" && styles.modeToggleActive
              ]}
              onPress={() => setWorkspaceMode((current) => (current === "reviewer" ? "poster" : "reviewer"))}
            >
              <Text
                style={[
                  styles.modeToggleText,
                  workspaceMode === "reviewer" && styles.modeToggleTextActive
                ]}
              >
                {workspaceMode === "reviewer" ? "Reviewer" : "Poster"}
              </Text>
            </Pressable>
            <Pressable style={styles.settingsButton} onPress={() => setSettingsVisible(true)}>
              <Text style={styles.settingsButtonText}>Settings</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.segmentRow}>
          <Pressable
            style={[styles.segmentButton, activeView === "post" && styles.segmentButtonActive]}
            onPress={() => setActiveView("post")}
          >
            <Text style={[styles.segmentText, activeView === "post" && styles.segmentTextActive]}>Post</Text>
          </Pressable>
          {showReviewTab ? (
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
            style={[styles.segmentButton, activeView === "status" && styles.segmentButtonActive]}
            onPress={() => setActiveView("status")}
          >
            <Text style={[styles.segmentText, activeView === "status" && styles.segmentTextActive]}>
              Status{unreadNotificationCount ? ` (${unreadNotificationCount})` : ""}
            </Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.container}>
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
                    </View>

                    <View style={styles.channelPicker}>
                      <View style={styles.composerMetaHeader}>
                        <Text style={styles.composerMetaLabel}>Channels</Text>
                        <Text style={styles.composerMetaHint}>Favorites first · main feed is automatic</Text>
                      </View>
                      <View style={styles.channelRow}>
                        {socialChannelOptions.map((channel) => {
                          const isSelected = selectedChannels.includes(channel.key);
                          return (
                            <Pressable
                              key={channel.key}
                              onPress={() => toggleSelectedChannel(channel.key)}
                              style={[
                                styles.channelPill,
                                channel.favorite && styles.channelPillFavorite,
                                isSelected && styles.channelPillActive
                              ]}
                            >
                              <Text
                                style={[
                                  styles.channelPillText,
                                  isSelected && styles.channelPillTextActive
                                ]}
                              >
                                {channel.label}
                              </Text>
                              {channel.favorite ? (
                                <Text
                                  style={[
                                    styles.channelFavoriteText,
                                    isSelected && styles.channelPillTextActive
                                  ]}
                                >
                                  Favorite
                                </Text>
                              ) : null}
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>

                    <TextInput
                      multiline
                      style={styles.captionInput}
                      value={caption}
                      onChangeText={setCaption}
                      placeholder="Add a short caption if it helps."
                      placeholderTextColor="#8f908c"
                    />

                    <View style={styles.composerMetaGroup}>
                      <View style={styles.composerMetaHeader}>
                        <Text style={styles.composerMetaLabel}>Tags</Text>
                        <Text style={styles.composerMetaHint}>Quick tags, optional</Text>
                      </View>
                      <TextInput
                        style={styles.metaInput}
                        value={tagsInput}
                        onChangeText={setTagsInput}
                        placeholder="goal, celebration, tournament"
                        placeholderTextColor="#9a98b8"
                        autoCapitalize="none"
                      />
                    </View>

                    <Pressable
                      onPress={() => setShowComposerDetails((value) => !value)}
                      style={styles.detailsToggle}
                    >
                      <View style={styles.detailsToggleRow}>
                        <Text style={styles.detailsToggleText}>
                          {showComposerDetails ? "Hide details" : "More details"}
                        </Text>
                        <Text style={styles.detailsToggleBadge}>Optional</Text>
                      </View>
                    </Pressable>

                    {showComposerDetails ? (
                      <View style={styles.composerDetailsPanel}>
                        <View style={styles.composerMetaGroup}>
                          <View style={styles.composerMetaHeader}>
                            <Text style={styles.composerMetaLabel}>Post type</Text>
                            <Text style={styles.composerMetaHint}>Pick the closest fit</Text>
                          </View>
                          <View style={styles.eventChoiceRow}>
                            {["Game", "Practice", "Tournament", "Other"].map((option) => (
                              <Pressable
                                key={option}
                                onPress={() => setEventTypeInput(option)}
                                style={[
                                  styles.audiencePill,
                                  eventTypeInput === option && styles.audiencePillActive
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.audiencePillText,
                                    eventTypeInput === option && styles.audiencePillTextActive
                                  ]}
                                >
                                  {option}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                          {eventTypeInput === "Other" ? (
                            <View style={styles.metaInputGroup}>
                              <Text style={styles.composerMetaHint}>Describe the event</Text>
                              <TextInput
                                style={styles.metaInput}
                                value={eventDetailInput}
                                onChangeText={setEventDetailInput}
                                placeholder="Team outing, banquet, award night"
                                placeholderTextColor="#9a98b8"
                              />
                            </View>
                          ) : null}
                        </View>

                        <View style={styles.composerMetaGrid}>
                          <View style={[styles.composerMetaGroup, styles.composerMetaHalf]}>
                            <View style={styles.composerMetaHeader}>
                              <Text style={styles.composerMetaLabel}>Opponent</Text>
                              <Text style={styles.composerMetaHint}>Game posts only</Text>
                            </View>
                            <TextInput
                              style={styles.metaInput}
                              value={opponentInput}
                              onChangeText={setOpponentInput}
                              placeholder="Lakeville North"
                              placeholderTextColor="#9a98b8"
                            />
                          </View>

                          <View style={[styles.composerMetaGroup, styles.composerMetaHalf]}>
                            <View style={styles.composerMetaHeader}>
                              <Text style={styles.composerMetaLabel}>Score</Text>
                              <Text style={styles.composerMetaHint}>Final or current</Text>
                            </View>
                            <TextInput
                              style={styles.metaInput}
                              value={scoreInput}
                              onChangeText={setScoreInput}
                              placeholder="3-1 win"
                              placeholderTextColor="#9a98b8"
                            />
                          </View>

                          <View style={styles.composerMetaGroup}>
                            <View style={styles.composerMetaHeader}>
                              <Text style={styles.composerMetaLabel}>Location</Text>
                              <Text style={styles.composerMetaHint}>Tap one or type yours</Text>
                            </View>
                            {locationSuggestions.length ? (
                              <View style={styles.locationSuggestionBlock}>
                                <View style={styles.locationSuggestionRow}>
                                {locationSuggestions.map((suggestion) => (
                                  <Pressable
                                    key={suggestion}
                                    onPress={() => setLocationInput(suggestion)}
                                    style={[
                                      styles.locationSuggestionPill,
                                      locationInput === suggestion && styles.audiencePillActive
                                    ]}
                                  >
                                    <Text
                                      style={[
                                        styles.locationSuggestionText,
                                        locationInput === suggestion && styles.audiencePillTextActive
                                      ]}
                                    >
                                      {suggestion}
                                    </Text>
                                  </Pressable>
                                ))}
                                </View>
                              </View>
                            ) : null}
                            <TextInput
                              style={styles.metaInput}
                              value={locationInput}
                              onChangeText={setLocationInput}
                              placeholder="Type another location"
                              placeholderTextColor="#9a98b8"
                            />
                          </View>
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.submitRow}>
                      <Pressable style={styles.inlineButton} onPress={pickFromLibrary}>
                        <Text style={styles.inlineButtonText}>Swap media</Text>
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
                  <Pressable style={styles.inlineStatusLink} onPress={() => setActiveView("status")}>
                    <Text style={styles.inlineStatusLinkText}>Open status feed</Text>
                  </Pressable>
                ) : null}
              </View>
            </>
          ) : activeView === "review" ? (
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
                  {reviewerEmail.trim() ? `Signed in as ${reviewerEmail.trim()}.` : "Add your reviewer email in Settings to use this view."}
                </Text>
              </View>

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
                      accessibilityRole="button"
                      accessibilityLabel={`${index === 0 ? "Up next" : `Then ${index + 1}`} review item. ${formatSubmissionHeadline(item.raw_text)}.`}
                    >
                      <GlassLayer />
                      <View style={styles.statusBadgeRow}>
                        <View style={styles.statusBadge}>
                          <Text style={styles.statusBadgeText}>{index === 0 ? "Up next" : `Then ${index + 1}`}</Text>
                        </View>
                        <Text style={styles.feedTime}>{formatSubmittedAt(item.created_at)}</Text>
                      </View>
                      <Text style={styles.feedHeadline}>{formatSubmissionHeadline(item.raw_text)}</Text>
                      <Text style={styles.feedSupport}>
                        {item.latest_review_summary || summarizeSubmissionProgress({ status: "needs_human_review" })}
                      </Text>
                      <View style={styles.metaChipRow}>
                        {buildSubmissionQuickChips(item).map((chip) => (
                          <View key={chip} style={styles.metaChip}>
                            <Text style={styles.metaChipText}>{chip}</Text>
                          </View>
                        ))}
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
      </View>

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

            {workspaceMode === "reviewer" ? (
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
                  Used when Reviewer mode is enabled from the header toggle.
                </Text>
              </View>
            ) : null}

            <View style={styles.settingsCard}>
              <GlassLayer />
            <Text style={styles.settingsLabel}>Workspace</Text>
            <TextInput style={styles.input} value={clubSlug} onChangeText={setClubSlug} placeholder="Workspace slug" />
              <TextInput style={[styles.input, styles.settingsStackTop]} value={teamSlug} onChangeText={setTeamSlug} placeholder="Team slug" />
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
                  For production-style builds, this should be preconfigured so normal users never need to edit it.
                </Text>
              </View>
            ) : null}
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
          setReviewDetailsExpanded(false);
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
                  setReviewDetailsExpanded(false);
                }}
              >
                <Text style={styles.closeButtonText}>Close</Text>
              </Pressable>
            </View>

            {loadingDetail || !selectedSubmissionDetail ? (
              <ActivityIndicator color="#12372d" />
            ) : (
              <ScrollView contentContainerStyle={styles.detailScrollContent}>
                <View style={styles.detailHero}>
                  <Text style={styles.detailStatus}>{formatStatusLabel(selectedSubmissionDetail.status)}</Text>
                  <Text style={styles.detailSummary}>
                    {formatSubmissionHeadline(selectedSubmissionDetail.raw_text)}
                  </Text>
                  <View style={styles.metaChipRow}>
                    {buildSubmissionQuickChips(selectedSubmissionDetail).map((chip) => (
                      <View key={chip} style={styles.metaChip}>
                        <Text style={styles.metaChipText}>{chip}</Text>
                      </View>
                    ))}
                  </View>
                  <Text style={styles.detailMeta}>{formatSubmittedAt(selectedSubmissionDetail.created_at)}</Text>
                </View>

                {activeView === "review" && selectedSubmissionDetail.latestApprovalRequest?.state === "pending" ? (
                  <View style={styles.reviewActionPanel}>
                    <Text style={styles.detailHeading}>Quick review</Text>
                    <Text style={styles.reviewActionTitle}>Approve is the default. Use the other actions only if this needs a fix or should stop here.</Text>
                    <Pressable
                      style={[
                        styles.reviewPrimaryActionButton,
                        reviewAction === "approve" && styles.reviewActionButtonApprove,
                        reviewAction === "approve" && styles.reviewActionButtonActive
                      ]}
                      onPress={() => selectReviewAction("approve")}
                    >
                      <Text
                        style={[
                          styles.reviewPrimaryActionText,
                          reviewAction === "approve" && styles.reviewActionButtonTextApprove
                        ]}
                      >
                        Approve now
                      </Text>
                    </Pressable>
                    <View style={styles.reviewSecondaryActionsRow}>
                      {[
                        { action: "request_changes", label: "Send back" },
                        { action: "reject", label: "Reject" }
                      ].map((option) => (
                        <Pressable
                          key={option.action}
                          style={[
                            styles.reviewSecondaryActionButton,
                            reviewAction === option.action && styles.reviewActionButtonActive,
                            option.action === "request_changes" && styles.reviewActionButtonChanges,
                            option.action === "reject" && styles.reviewActionButtonReject
                          ]}
                          onPress={() => selectReviewAction(option.action)}
                        >
                          <Text
                            style={[
                              styles.reviewSecondaryActionText,
                              reviewAction === option.action && styles.reviewActionButtonTextActive,
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
                            style={styles.detailResubmitInput}
                            value={reviewActionNotes}
                            onChangeText={setReviewActionNotes}
                            placeholder="Add a short note."
                            placeholderTextColor="#8f908c"
                          />
                        ) : null}
                      </View>
                    ) : null}

                    {selectedSubmissionDetail.status === "needs_metadata" ? (
                      <>
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

                        {reviewActionStatus && reviewActionStatus !== "Pick a review item to get started." ? (
                          <Text style={styles.reviewActionStatus}>{reviewActionStatus}</Text>
                        ) : null}
                      </>
                    ) : null}
                  </View>
                ) : null}

                {(selectedSubmissionDetail.status === "needs_metadata" || reviewDetailsExpanded) &&
                (selectedSubmissionDetail.media?.length || resubmissionAsset) ? (
                  <View style={styles.detailMediaCard}>
                    {resubmissionAsset && !isVideoAsset(resubmissionAsset) ? (
                      <Image
                        source={{ uri: resubmissionAsset.uri }}
                        style={styles.detailMediaPreview}
                      />
                    ) : selectedSubmissionDetail.media[0]?.previewUrl &&
                      !String(selectedSubmissionDetail.media[0]?.mimeType || "").startsWith("video/") ? (
                      <Image
                        source={{ uri: selectedSubmissionDetail.media[0].previewUrl }}
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
                      style={styles.detailResubmitInput}
                      value={resubmissionText}
                      onChangeText={setResubmissionText}
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

                <Pressable
                  style={styles.moreDetailsButton}
                  onPress={() => setReviewDetailsExpanded((current) => !current)}
                >
                  <Text style={styles.moreDetailsButtonText}>
                    {reviewDetailsExpanded ? "Hide details" : "More details"}
                  </Text>
                </Pressable>

                {reviewDetailsExpanded ? (
                  <View style={styles.moreDetailsSection}>
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
                      Workspace: {selectedSubmissionDetail.club_slug}
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
                  </View>
                ) : null}

                {selectedSubmissionDetail.publishedPost ? (
                  <>
                    <Text style={styles.detailHeading}>Publishing</Text>
                    <Text style={styles.detailBody}>Published to {selectedSubmissionDetail.publishedPost.destinationName}</Text>
                    <Text style={styles.detailBody}>{formatSubmittedAt(selectedSubmissionDetail.publishedPost.publishedAt)}</Text>
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
    backgroundColor: "#e8e6f6",
    paddingTop: Platform.OS === "ios" ? 42 : 6
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
    paddingTop: 14,
    paddingBottom: 12
  },
  chromeActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10
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
  modeToggle: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)"
  },
  modeToggleActive: {
    backgroundColor: "rgba(71, 62, 153, 0.92)",
    borderColor: "rgba(255,255,255,0.16)"
  },
  modeToggleText: {
    color: "#342c67",
    fontWeight: "900",
    letterSpacing: 0.2
  },
  modeToggleTextActive: {
    color: "#f8f7ff"
  },
  segmentRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 14
  },
  segmentButton: {
    paddingHorizontal: 16,
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
    height: 470,
    justifyContent: "flex-end",
    backgroundColor: "#d6ddd7"
  },
  previewImageMedia: {
    borderRadius: 28
  },
  previewImageShade: {
    flex: 1,
    justifyContent: "space-between",
    padding: 16
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
    fontSize: 26,
    lineHeight: 28,
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
    gap: 10
  },
  previewMediaOverlay: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderRadius: 22,
    padding: 14,
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
    fontSize: 21,
    lineHeight: 24,
    fontWeight: "800"
  },
  previewOverlayHint: {
    color: "#efeefe",
    lineHeight: 18,
    fontSize: 13
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
    padding: 12,
    gap: 8,
    marginTop: 8,
    marginHorizontal: 8,
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
    fontSize: 18,
    lineHeight: 21,
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
  audienceHelpText: {
    color: "#756f9b",
    fontSize: 12,
    lineHeight: 17,
    marginTop: -2
  },
  channelPicker: {
    gap: 8,
    padding: 10,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.30)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.50)"
  },
  channelRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7
  },
  channelPill: {
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.52)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.64)",
    gap: 2
  },
  channelPillFavorite: {
    borderColor: "rgba(255, 177, 92, 0.42)"
  },
  channelPillActive: {
    backgroundColor: "rgba(82, 71, 173, 0.88)",
    borderColor: "rgba(255,255,255,0.18)"
  },
  channelPillText: {
    color: "#514982",
    fontSize: 12,
    fontWeight: "800"
  },
  channelPillTextActive: {
    color: "#f8f7ff"
  },
  channelFavoriteText: {
    color: "#9b7442",
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6
  },
  captionInput: {
    minHeight: 84,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 14,
    backgroundColor: "rgba(255,255,255,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.66)",
    color: "#2a2451",
    textAlignVertical: "top",
    fontSize: 16,
    lineHeight: 22
  },
  composerMetaGroup: {
    gap: 8
  },
  composerDetailsPanel: {
    gap: 12,
    marginTop: 4,
    padding: 12,
    paddingLeft: 14,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.34)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.54)",
    borderLeftWidth: 4,
    borderLeftColor: "rgba(109,99,207,0.72)",
    shadowColor: "#faf8ff",
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 2
  },
  composerMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12
  },
  composerMetaHalf: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 160
  },
  metaInputGroup: {
    gap: 10
  },
  eventChoiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  composerMetaHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8
  },
  composerMetaLabel: {
    color: "#7369a2",
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2
  },
  composerMetaHint: {
    color: "#7b7698",
    fontSize: 12,
    flexShrink: 1,
    textAlign: "right"
  },
  locationSuggestionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8
  },
  locationSuggestionBlock: {
    gap: 8,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.26)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.36)"
  },
  locationSuggestionPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.52)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.65)"
  },
  locationSuggestionText: {
    color: "#4f467f",
    fontSize: 12,
    fontWeight: "700"
  },
  suggestionBlock: {
    gap: 8
  },
  metaInput: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
    backgroundColor: "rgba(255,255,255,0.58)",
    paddingHorizontal: 13,
    paddingVertical: 12,
    color: "#2a2451"
  },
  metaInputTall: {
    minHeight: 92,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
    backgroundColor: "rgba(255,255,255,0.58)",
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: "#2a2451",
    textAlignVertical: "top"
  },
  submitRow: {
    flexDirection: "row",
    gap: 6
  },
  detailsToggle: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.48)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.64)",
    shadowColor: "#ffffff",
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 1
  },
  detailsToggleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12
  },
  detailsToggleText: {
    color: "#5e5894",
    fontWeight: "800",
    fontSize: 14
  },
  detailsToggleBadge: {
    color: "#7f78a9",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1
  },
  submitButton: {
    flex: 1,
    borderRadius: 20,
    backgroundColor: "#6d63cf",
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center"
  },
  submitButtonText: {
    color: "#f8f7ff",
    fontSize: 15,
    fontWeight: "800"
  },
  buttonDisabled: {
    opacity: 0.45
  },
  miniStatusCard: {
    backgroundColor: "rgba(255,255,255,0.38)",
    borderRadius: 24,
    padding: 16,
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
  settingsLabel: {
    color: "#7369a2",
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1.2
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
  detailScrollContent: {
    paddingBottom: 26
  },
  detailHero: {
    backgroundColor: "#f1e8da",
    borderRadius: 22,
    padding: 14,
    gap: 6
  },
  detailStatus: {
    color: "#176744",
    fontWeight: "800"
  },
  detailSummary: {
    color: "#11261f",
    fontSize: 18,
    lineHeight: 22,
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
    height: 220,
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
    gap: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.74)"
  },
  reviewActionTitle: {
    color: "#2a2451",
    fontWeight: "800",
    fontSize: 17,
    lineHeight: 22
  },
  reviewPrimaryActionButton: {
    borderRadius: 22,
    paddingVertical: 15,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(205, 246, 224, 0.80)",
    borderWidth: 1,
    borderColor: "rgba(112, 204, 160, 0.36)"
  },
  reviewPrimaryActionText: {
    color: "#176744",
    fontWeight: "800",
    fontSize: 16
  },
  reviewSecondaryActionsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap"
  },
  reviewSecondaryActionButton: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: 1,
    borderColor: "rgba(91, 82, 186, 0.18)",
    alignItems: "center",
    justifyContent: "center"
  },
  reviewSecondaryActionText: {
    color: "#4f46a6",
    fontWeight: "700"
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
