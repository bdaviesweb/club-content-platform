const latestReviewRunQuery = `
  SELECT
    rr.id,
    rr.agent_name AS "agentName",
    rr.model,
    rr.result_status AS "resultStatus",
    rr.confidence,
    rr.summary,
    rr.created_at AS "createdAt"
  FROM review_runs rr
  WHERE rr.submission_id = $1
  ORDER BY rr.created_at DESC
  LIMIT 1
`;

const latestApprovalRequestQuery = `
  SELECT
    ar.id,
    ar.state,
    ar.approver_role AS "approverRole",
    ar.created_at AS "createdAt",
    ar.updated_at AS "updatedAt",
    u.full_name AS "approverName",
    (
      SELECT jsonb_build_object(
        'id', aa.id,
        'action', aa.action,
        'notes', aa.notes,
        'createdAt', aa.created_at,
        'actedByName', au.full_name,
        'reasonCode',
        (
          SELECT al.metadata->>'reasonCode'
          FROM audit_logs al
          WHERE al.entity_type = 'approval_request'
            AND al.entity_id = ar.id
            AND al.action = aa.action
          ORDER BY al.created_at DESC
          LIMIT 1
        )
      )
      FROM approval_actions aa
      JOIN users au ON au.id = aa.acted_by_user_id
      WHERE aa.approval_request_id = ar.id
      ORDER BY aa.created_at DESC
      LIMIT 1
    ) AS "latestAction"
  FROM approval_requests ar
  JOIN users u ON u.id = ar.approver_user_id
  WHERE ar.submission_id = $1
  ORDER BY ar.created_at DESC
  LIMIT 1
`;

const publishedPostQuery = `
  SELECT
    pp.id,
    pp.external_post_id AS "externalPostId",
    pp.published_at AS "publishedAt",
    pd.name AS "destinationName",
    pd.destination_type AS "destinationType"
  FROM published_posts pp
  JOIN publishing_destinations pd ON pd.id = pp.destination_id
  WHERE pp.submission_id = $1
  ORDER BY pp.published_at DESC
  LIMIT 1
`;

export async function loadSubmissionWorkflowDetail({ pool, submissionId }) {
  const [latestReviewRun, latestApprovalRequest, publishedPost] = await Promise.all([
    pool.query(latestReviewRunQuery, [submissionId]),
    pool.query(latestApprovalRequestQuery, [submissionId]),
    pool.query(publishedPostQuery, [submissionId])
  ]);

  return {
    latestReviewRun: latestReviewRun.rows[0] || null,
    latestApprovalRequest: latestApprovalRequest.rows[0] || null,
    publishedPost: publishedPost.rows[0] || null
  };
}
