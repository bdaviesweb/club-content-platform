import {
  createAndDeliverNotification,
  internalDestinationType,
  reviewThresholds,
  submissionEvents
} from "../../../packages/shared/src/index.js";
import { publishToDestination } from "./publishing.js";
import {
  buildPublishedEventPayload,
  buildPublishedNotificationPayload,
  buildPublishFailureEventPayload,
  buildPublishFailureSummary
} from "./publish-outcome.js";
import { buildReviewArtifacts } from "./review-provider.js";
import {
  choosePolicyApproverRole,
  loadEffectiveWorkflowPolicy,
  shouldAutoApproveSubmission
} from "./workflow-policy.js";

export { buildReviewArtifacts } from "./review-provider.js";

function chooseRoutingDecision(submission, reviewArtifacts, policy) {
  const policyApproverRole = choosePolicyApproverRole({
    visibilityTarget: submission.visibility_target,
    riskScore: reviewArtifacts.riskScore,
    policy
  });
  const agentRouting = reviewArtifacts.structured?.review?.routing_decision;

  if (
    policy.allowAgentRouting &&
    reviewArtifacts.mode === "hermes" &&
    agentRouting?.approver_role
  ) {
    return {
      approverRole: agentRouting.approver_role,
      routingSource: "hermes_agent",
      agentRationale: agentRouting.rationale || null,
      localFallbackApproverRole: policyApproverRole,
      policySource: "agent_override"
    };
  }

  return {
    approverRole: policyApproverRole,
    routingSource:
      reviewArtifacts.mode === "hermes" ? "local_rules" : reviewArtifacts.mode,
    agentRationale: null,
    localFallbackApproverRole: null,
    policySource: "workflow_policy"
  };
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
  const workflowPolicy = await loadEffectiveWorkflowPolicy(client, submission.club_id);
  const routingDecision = chooseRoutingDecision(
    submission,
    reviewArtifacts,
    workflowPolicy
  );
  const approverRole = routingDecision.approverRole;
  const autoApproval = shouldAutoApproveSubmission({
    submission,
    reviewArtifacts,
    policy: workflowPolicy
  });

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
      autoApproval.allowed ? "approved_internal" : "needs_human_review",
      reviewArtifacts.riskScore,
      reviewArtifacts.captionDraft,
      JSON.stringify({
        approverRole,
        rationale: reviewArtifacts.summary,
        reviewMode: reviewArtifacts.mode,
        routingSource: routingDecision.routingSource,
        policySource: routingDecision.policySource,
        agentRationale: routingDecision.agentRationale,
        localFallbackApproverRole: routingDecision.localFallbackApproverRole,
        autoApproved: autoApproval.allowed,
        autoApproveReason: autoApproval.allowed ? autoApproval.reason : null,
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

  if (autoApproval.allowed) {
    await client.query(
      `
      INSERT INTO submission_events (submission_id, event_name, payload)
      VALUES ($1, $2, $3::jsonb)
      `,
      [
        submission.id,
        submissionEvents.approved,
        JSON.stringify({
          submissionId: submission.id,
          status: "approved_internal",
          autoApproved: true,
          autoApproveReason: autoApproval.reason,
          policySource: routingDecision.policySource
        })
      ]
    );

    await client.query(
      `
      INSERT INTO audit_logs (entity_type, entity_id, action, metadata)
      VALUES ('submission', $1, 'auto_approved', $2::jsonb)
      `,
      [
        submission.id,
        JSON.stringify({
          reason: autoApproval.reason,
          reviewMode: reviewArtifacts.mode,
          riskScore: reviewArtifacts.riskScore,
          policySource: routingDecision.policySource,
          clubId: submission.club_id
        })
      ]
    );

    return;
  }

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
          ...buildPublishFailureEventPayload(error)
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
      JSON.stringify(buildPublishedEventPayload(publishResult))
    ]
  );

  await createAndDeliverNotification(client, {
    userId: submission.submitted_by_user_id,
    type: "submission_published",
    payload: buildPublishedNotificationPayload({
      submissionId: submission.id,
      result: publishResult
    })
  });
}
