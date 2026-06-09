import {
  createAndDeliverNotification,
  internalDestinationType,
  reviewThresholds,
  submissionEvents
} from "../../../packages/shared/src/index.js";
import { draftCaption, scoreRisk, summarizeReview } from "./fallback-review.js";
import { hasOpenAI, runModeration, runStructuredReview } from "./openai.js";
import { buildAudienceReviewPackage } from "./audience-rewrites.js";
import { evaluateClubRouting, loadClubPolicy } from "./policy.js";

export function chooseApproverRole(submission) {
  if (
    submission.visibility_target === "public" ||
    Number(submission.risk_score) >= reviewThresholds.mediumRisk
  ) {
    return "club_comms";
  }

  return "team_manager";
}

function normalizeChannelKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseSubmissionChannels(submission) {
  if (Array.isArray(submission?.selected_channels)) {
    return submission.selected_channels
      .map((channel) => String(channel || "").trim())
      .filter(Boolean);
  }

  const rawChannels = String(submission?.raw_text || "")
    .match(/^Channels:\s*(.+)$/gim)?.[0];

  if (!rawChannels) {
    return [];
  }

  return rawChannels
    .replace(/^Channels:\s*/i, "")
    .split(",")
    .map((channel) => channel.trim())
    .filter(Boolean);
}

function uniqueDestinations(destinations) {
  const seen = new Set();
  return destinations.filter((destination) => {
    if (!destination?.id || seen.has(destination.id)) {
      return false;
    }
    seen.add(destination.id);
    return true;
  });
}

function destinationMatchesSelectedChannels(destination, selectedChannels) {
  const configChannelKey = normalizeChannelKey(destination?.config?.channelKey);
  const destinationTypeKey = normalizeChannelKey(destination?.destination_type);
  return selectedChannels.some(
    (channel) => normalizeChannelKey(channel) === configChannelKey || normalizeChannelKey(channel) === destinationTypeKey
  );
}

async function loadApprovedDestinations(client, submission, clubPolicy) {
  const result = await client.query(
    `
    SELECT id, destination_type, name, config
    FROM publishing_destinations
    WHERE club_id = $1 AND is_active = TRUE
    ORDER BY created_at ASC
    `,
    [submission.club_id]
  );

  const selectedChannels = parseSubmissionChannels(submission);
  const publishMainFeedByDefault = clubPolicy?.routing?.publishMainFeedByDefault !== false;
  const destinations = [];

  if (publishMainFeedByDefault) {
    const mainFeedDestinations = result.rows.filter(
      (destination) => destination.destination_type === internalDestinationType
    );
    destinations.push(...mainFeedDestinations);
  }

  destinations.push(
    ...result.rows.filter((destination) => destinationMatchesSelectedChannels(destination, selectedChannels))
  );

  return uniqueDestinations(destinations);
}

async function findApprover(client, clubId, preferredRole) {
  const fallbackRoles = [preferredRole, "club_comms", "club_admin"];

  for (const role of fallbackRoles) {
    const result = await client.query(
      `
      SELECT u.id
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.club_id = $1 AND m.role = $2
      ORDER BY m.created_at ASC
      LIMIT 1
      `,
      [clubId, role]
    );

    if (result.rowCount) {
      return {
        userId: result.rows[0].id,
        role
      };
    }
  }

  return null;
}

function riskLevelToScore(riskLevel) {
  switch (riskLevel) {
    case "high":
      return 0.85;
    case "medium":
      return 0.55;
    default:
      return 0.15;
  }
}

async function buildReviewArtifacts(submission, clubPolicy) {
  const buildFallbackArtifacts = () => {
    const fallbackRiskScore = scoreRisk(submission.raw_text || "");
    return {
      mode: "fallback",
      riskScore: fallbackRiskScore,
      summary: summarizeReview(submission.raw_text || "", fallbackRiskScore),
      captionDraft: draftCaption(submission.raw_text || "", submission.submitter_name),
      moderation: {
        model: "local-rules",
        flagged: fallbackRiskScore >= reviewThresholds.highRisk,
        categories: {},
        categoryScores: {}
      },
      structured: null,
      findings:
        fallbackRiskScore >= reviewThresholds.mediumRisk
          ? [
              {
                type: "policy",
                severity: fallbackRiskScore >= reviewThresholds.highRisk ? "high" : "medium",
                message: "Fallback rules found language or details that require review."
              }
            ]
          : []
    };
  };

  if (!hasOpenAI()) {
    return buildFallbackArtifacts();
  }

  try {
    const moderation = await runModeration(submission.raw_text || "");
    const structured = await runStructuredReview({
      rawText: submission.raw_text || "",
      visibilityTarget: submission.visibility_target,
      contentType: submission.content_type,
      clubPolicy
    });
    const review = structured.review || {};
    const riskScore = moderation.flagged
      ? Math.max(riskLevelToScore(review.risk_level), 0.8)
      : riskLevelToScore(review.risk_level);

    return {
      mode: "openai",
      riskScore,
      summary: review.summary || "AI review completed.",
      captionDraft:
        review.caption_draft ||
        draftCaption(submission.raw_text || "", submission.submitter_name),
      moderation,
      structured,
      findings: Array.isArray(review.findings) ? review.findings : []
    };
  } catch (error) {
    const fallback = buildFallbackArtifacts();
    return {
      ...fallback,
      summary: `${fallback.summary} OpenAI review unavailable; local fallback used.`
    };
  }
}

export async function processSubmissionCreated(client, eventRow) {
  const submissionResult = await client.query(
    `
    SELECT s.*, u.full_name AS submitter_name
    FROM submissions s
    JOIN users u ON u.id = s.submitted_by_user_id
    WHERE s.id = $1
    `,
    [eventRow.submission_id]
  );

  if (!submissionResult.rowCount) {
    throw new Error(`Submission not found: ${eventRow.submission_id}`);
  }

  const submission = submissionResult.rows[0];
  const clubPolicy = await loadClubPolicy(client, submission.club_id);
  const reviewArtifacts = await buildReviewArtifacts(submission, clubPolicy);
  const routingDecision = evaluateClubRouting(submission, reviewArtifacts, clubPolicy);
  const audienceReviewPackage = buildAudienceReviewPackage({
    rawText: submission.raw_text || "",
    captionDraft: reviewArtifacts.captionDraft,
    analysisSummary: reviewArtifacts.summary,
    riskScore: reviewArtifacts.riskScore,
    routingDecision
  });
  const approverRole = routingDecision.approverRole;
  const isAutoApproved = routingDecision.route === "auto_approve";

  await client.query(
    `
    UPDATE submissions
    SET status = $2,
        risk_score = $3,
        caption_draft = $4,
        routing_decision = $5::jsonb,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      submission.id,
      isAutoApproved ? "approved_internal" : "needs_human_review",
      reviewArtifacts.riskScore,
      reviewArtifacts.captionDraft,
      JSON.stringify({
        approverRole,
        route: routingDecision.route,
        policyHits: routingDecision.policyHits,
        recommendedChannels: routingDecision.recommendedChannels,
        blockedChannels: routingDecision.blockedChannels,
        rationale: reviewArtifacts.summary,
        analysisCore: audienceReviewPackage.analysisCore,
        audienceRewrites: audienceReviewPackage.audienceRewrites,
        reviewMode: reviewArtifacts.mode,
        reviewRequiredReason:
          reviewArtifacts.structured?.review?.review_required_reason || null,
        policyReasons: routingDecision.reasons
      })
    ]
  );

  const reviewRun = await client.query(
    `
    INSERT INTO review_runs (
      submission_id,
      agent_name,
      model,
      version,
      result_status,
      confidence,
      summary,
      raw_output_json
    )
    VALUES ($1, 'moderation-agent', $2, '0.1.0', $3, $4, $5, $6::jsonb)
    RETURNING id
    `,
    [
      submission.id,
      reviewArtifacts.moderation.model,
      reviewArtifacts.riskScore >= reviewThresholds.highRisk ||
      reviewArtifacts.moderation.flagged
        ? "flagged"
        : "passed",
      reviewArtifacts.structured?.review?.confidence || 0.8,
      reviewArtifacts.summary,
      JSON.stringify({
        riskScore: reviewArtifacts.riskScore,
        rawText: submission.raw_text || "",
        moderation: reviewArtifacts.moderation,
        structuredReview: reviewArtifacts.structured?.review || null,
        analysisCore: audienceReviewPackage.analysisCore,
        policy: clubPolicy,
        routingDecision
      })
    ]
  );

  for (const finding of reviewArtifacts.findings) {
    await client.query(
      `
      INSERT INTO review_findings (
        review_run_id,
        finding_type,
        severity,
        message
      )
      VALUES ($1, $2, $3, $4)
      `,
      [
        reviewRun.rows[0].id,
        finding.type || "policy",
        finding.severity || "medium",
        finding.message || "AI review flagged this submission."
      ]
    );
  }

  await client.query(
    `
    INSERT INTO review_runs (
      submission_id,
      agent_name,
      model,
      version,
      result_status,
      confidence,
      summary,
      raw_output_json
    )
    VALUES ($1, 'enrichment-agent', $2, '0.1.0', 'passed', $3, $4, $5::jsonb)
    `,
    [
      submission.id,
      reviewArtifacts.structured?.model || "local-caption-draft",
      0.75,
      "Caption draft generated for reviewer use.",
      JSON.stringify({
        captionDraft: reviewArtifacts.captionDraft,
        audienceRewrites: audienceReviewPackage.audienceRewrites,
        mode: reviewArtifacts.mode,
        policy: clubPolicy
      })
    ]
  );

  await client.query(
    `
    INSERT INTO submission_events (submission_id, event_name, payload)
    VALUES ($1, $2, $3::jsonb)
    `,
    [
      submission.id,
      submissionEvents.routed,
      JSON.stringify({
        route: routingDecision.route,
        approverRole,
        policyHits: routingDecision.policyHits,
        reasons: routingDecision.reasons
      })
    ]
  );

  if (isAutoApproved) {
    await client.query(
      `
      INSERT INTO submission_events (submission_id, event_name, payload)
      VALUES ($1, $2, $3::jsonb)
      `,
      [
        submission.id,
        submissionEvents.approved,
        JSON.stringify({
          approvalRequestId: null,
          route: routingDecision.route
        })
      ]
    );
  } else {
    const approver = await findApprover(client, submission.club_id, approverRole);

    if (!approver) {
      throw new Error(`No approver found for role ${approverRole}`);
    }

    await client.query(
      `
      INSERT INTO approval_requests (
        submission_id,
        approver_user_id,
        approver_role,
        state
      )
      VALUES ($1, $2, $3, 'pending')
      `,
      [submission.id, approver.userId, approver.role]
    );

    await client.query(
      `
      INSERT INTO submission_events (submission_id, event_name, payload)
      VALUES ($1, $2, $3::jsonb)
      `,
      [
        submission.id,
        submissionEvents.approvalRequested,
        JSON.stringify({
          approverRole: approver.role,
          originallyRequestedRole: approverRole,
          route: routingDecision.route
        })
      ]
    );

    await createAndDeliverNotification(client, {
      userId: submission.submitted_by_user_id,
      type: "submission_review_started",
      payload: {
        submissionId: submission.id,
        status: "needs_human_review",
        approverRole: approver.role,
        summary: reviewArtifacts.summary,
        route: routingDecision.route
      }
    });
  }
}

export async function processSubmissionApproved(client, eventRow) {
  const submissionResult = await client.query(
    `
    SELECT s.*
    FROM submissions s
    WHERE s.id = $1
    `,
    [eventRow.submission_id]
  );

  if (!submissionResult.rowCount) {
    throw new Error(`Submission not found: ${eventRow.submission_id}`);
  }

  const submission = submissionResult.rows[0];

  const clubPolicy = await loadClubPolicy(client, submission.club_id);
  const destinations = await loadApprovedDestinations(client, submission, clubPolicy);

  if (!destinations.length) {
    throw new Error("No publishing destinations configured");
  }

  for (const destination of destinations) {
    await client.query(
      `
      INSERT INTO publishing_jobs (
        submission_id,
        destination_id,
        state,
        result_summary
      )
      VALUES ($1, $2, 'succeeded', $3)
      `,
      [
        submission.id,
        destination.id,
        destination.destination_type === internalDestinationType
          ? "Published to the primary feed by worker"
          : `Published to ${destination.name} by worker`
      ]
    );

    await client.query(
      `
      INSERT INTO published_posts (
        submission_id,
        destination_id,
        external_post_id
      )
      VALUES ($1, $2, $3)
      `,
      [submission.id, destination.id, `${destination.destination_type}:${submission.id}`]
    );
  }

  await client.query(
    `
    UPDATE submissions
    SET status = 'published', updated_at = NOW()
    WHERE id = $1
    `,
    [submission.id]
  );

  await client.query(
    `
    INSERT INTO submission_events (submission_id, event_name, payload)
    VALUES ($1, $2, $3::jsonb)
    `,
    [
      submission.id,
      submissionEvents.published,
      JSON.stringify({
        destinationType: internalDestinationType,
        destinationCount: destinations.length,
        destinationTypes: destinations.map((destination) => destination.destination_type)
      })
    ]
  );

  await createAndDeliverNotification(client, {
    userId: submission.submitted_by_user_id,
    type: "submission_published",
    payload: {
      submissionId: submission.id,
      status: "published",
      destinationType: internalDestinationType,
      destinationCount: destinations.length,
      destinationTypes: destinations.map((destination) => destination.destination_type)
    }
  });
}
