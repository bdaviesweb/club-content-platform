import {
  createAndDeliverNotification,
  internalDestinationType,
  reviewThresholds,
  submissionEvents
} from "../../../packages/shared/src/index.js";
import { draftCaption, scoreRisk, summarizeReview } from "./fallback-review.js";
import {
  hasHermesReviewAgent,
  runHermesReviewAgent
} from "./hermes-review.js";
import { hasOpenAI, runModeration, runStructuredReview } from "./openai.js";
import { publishToDestination } from "./publishing.js";

export function chooseApproverRole(submission) {
  if (
    submission.visibility_target === "public" ||
    Number(submission.risk_score) >= reviewThresholds.mediumRisk
  ) {
    return "club_comms";
  }

  return "team_manager";
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

function buildPublishFailureSummary(error) {
  const message = error?.message || "Unknown publishing failure";
  return `Publishing failed: ${message}`;
}

function buildReviewFallbackReason(provider, error) {
  const message = error?.message || "unknown error";
  return `${provider} review unavailable: ${message}`;
}

export async function buildReviewArtifacts(submission) {
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

  const buildOpenAIArtifacts = async (summaryPrefix = "") => {
    try {
      const moderation = await runModeration(submission.raw_text || "");
      const structured = await runStructuredReview({
        rawText: submission.raw_text || "",
        visibilityTarget: submission.visibility_target,
        contentType: submission.content_type
      });
      const review = structured.review || {};
      const riskScore = moderation.flagged
        ? Math.max(riskLevelToScore(review.risk_level), 0.8)
        : riskLevelToScore(review.risk_level);

      return {
        mode: "openai",
        riskScore,
        summary: `${summaryPrefix}${review.summary || "AI review completed."}`,
        captionDraft:
          review.caption_draft ||
          draftCaption(submission.raw_text || "", submission.submitter_name),
        moderation,
        structured,
        findings: Array.isArray(review.findings) ? review.findings : []
      };
    } catch (error) {
      const fallback = buildFallbackArtifacts();
      const fallbackReason = buildReviewFallbackReason("OpenAI", error);
      return {
        ...fallback,
        fallbackReason,
        summary: `${fallback.summary} ${summaryPrefix}${fallbackReason}; local fallback used.`
      };
    }
  };

  if (hasHermesReviewAgent()) {
    try {
      const structured = await runHermesReviewAgent({
        rawText: submission.raw_text || "",
        visibilityTarget: submission.visibility_target,
        contentType: submission.content_type,
        submitterName: submission.submitter_name
      });
      const review = structured.review || {};
      const riskScore = riskLevelToScore(review.risk_level);

      return {
        mode: "hermes",
        riskScore,
        summary: review.summary || "Hermes review completed.",
        captionDraft:
          review.caption_draft ||
          draftCaption(submission.raw_text || "", submission.submitter_name),
        moderation: {
          model: structured.model,
          flagged: riskScore >= reviewThresholds.highRisk,
          categories: {},
          categoryScores: {}
        },
        structured,
        findings: Array.isArray(review.findings) ? review.findings : []
      };
    } catch (error) {
      const fallback = buildFallbackArtifacts();
      const fallbackReason = buildReviewFallbackReason("Hermes", error);
      if (hasOpenAI()) {
        return buildOpenAIArtifacts(`${fallbackReason}; `);
      }

      return {
        ...fallback,
        fallbackReason,
        summary: `${fallback.summary} ${fallbackReason}; local fallback used.`
      };
    }
  }

  if (!hasOpenAI()) {
    return buildFallbackArtifacts();
  }

  return buildOpenAIArtifacts();
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
  const reviewArtifacts = await buildReviewArtifacts(submission);
  const approverRole = chooseApproverRole({
    visibility_target: submission.visibility_target,
    risk_score: reviewArtifacts.riskScore
  });

  await client.query(
    `
    UPDATE submissions
    SET status = 'needs_human_review',
        risk_score = $2,
        caption_draft = $3,
        routing_decision = $4::jsonb,
        updated_at = NOW()
    WHERE id = $1
    `,
    [
      submission.id,
      reviewArtifacts.riskScore,
      reviewArtifacts.captionDraft,
      JSON.stringify({
        approverRole,
        rationale: reviewArtifacts.summary,
        reviewMode: reviewArtifacts.mode,
        reviewRequiredReason:
          reviewArtifacts.structured?.review?.review_required_reason || null
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
        fallbackReason: reviewArtifacts.fallbackReason || null
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
        mode: reviewArtifacts.mode
      })
    ]
  );

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
        originallyRequestedRole: approverRole
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
      summary: reviewArtifacts.summary
    }
  });
}

export async function processSubmissionApproved(
  client,
  eventRow,
  { publishImpl = publishToDestination } = {}
) {
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

  const destination = await client.query(
    `
    SELECT id, destination_type, name, config
    FROM publishing_destinations
    WHERE club_id = $1 AND destination_type = $2 AND is_active = TRUE
    ORDER BY created_at ASC
    LIMIT 1
    `,
    [submission.club_id, internalDestinationType]
  );

  if (!destination.rowCount) {
    throw new Error("Internal publishing destination not configured");
  }

  const publishDestination = destination.rows[0];
  let publishResult;
  try {
    publishResult = await publishImpl({
      submission,
      destination: publishDestination
    });
  } catch (error) {
    const resultSummary = buildPublishFailureSummary(error);
    await client.query(
      `
      INSERT INTO publishing_jobs (
        submission_id,
        destination_id,
        state,
        attempt_count,
        result_summary
      )
      VALUES ($1, $2, 'failed', 1, $3)
      `,
      [submission.id, publishDestination.id, resultSummary]
    );

    await client.query(
      `
      UPDATE submissions
      SET status = 'publish_failed', updated_at = NOW()
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
        submissionEvents.publishFailed,
        JSON.stringify({
          destinationType: publishDestination.destination_type,
          destinationName: publishDestination.name,
          error: error?.message || "Unknown publishing failure"
        })
      ]
    );

    return;
  }

  await client.query(
    `
    INSERT INTO publishing_jobs (
      submission_id,
      destination_id,
      state,
      result_summary,
      external_reference
    )
    VALUES ($1, $2, 'succeeded', $3, $4)
    `,
    [
      submission.id,
      publishDestination.id,
      publishResult.resultSummary,
      publishResult.externalReference
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
    [submission.id, publishDestination.id, publishResult.externalPostId]
  );

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
        destinationType: publishResult.destinationType,
        destinationName: publishResult.destinationName
      })
    ]
  );

  await createAndDeliverNotification(client, {
    userId: submission.submitted_by_user_id,
    type: "submission_published",
    payload: {
      submissionId: submission.id,
      status: "published",
      destinationType: publishResult.destinationType,
      destinationName: publishResult.destinationName
    }
  });
}
