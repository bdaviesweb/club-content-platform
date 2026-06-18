const approvalRequestDetailQuery = `
  SELECT
    ar.id,
    ar.state,
    ar.approver_role,
    ar.created_at,
    ar.updated_at,
    s.id AS submission_id,
    s.status AS submission_status,
    s.content_type,
    s.raw_text,
    s.caption_draft,
    s.visibility_target,
    s.risk_score,
    s.routing_decision,
    su.full_name AS submitter_name,
    su.email AS submitter_email,
    au.full_name AS approver_name,
    au.email AS approver_email,
    COALESCE(
      json_agg(
        DISTINCT jsonb_build_object(
          'id', sm.id,
          'objectKey', sm.object_key,
          'mediaType', sm.media_type,
          'mimeType', sm.mime_type
        )
      ) FILTER (WHERE sm.id IS NOT NULL),
      '[]'::json
    ) AS media,
    COALESCE(
      (
        SELECT json_agg(
          jsonb_build_object(
            'id', rr.id,
            'agentName', rr.agent_name,
            'model', rr.model,
            'resultStatus', rr.result_status,
            'confidence', rr.confidence,
            'summary', rr.summary,
            'rawOutput', rr.raw_output_json,
            'createdAt', rr.created_at,
            'findings',
            COALESCE(
              (
                SELECT json_agg(
                  jsonb_build_object(
                    'id', rf.id,
                    'type', rf.finding_type,
                    'severity', rf.severity,
                    'message', rf.message,
                    'metadata', rf.metadata,
                    'createdAt', rf.created_at
                  )
                  ORDER BY rf.created_at ASC
                )
                FROM review_findings rf
                WHERE rf.review_run_id = rr.id
              ),
              '[]'::json
            )
          )
          ORDER BY rr.created_at DESC
        )
        FROM review_runs rr
        WHERE rr.submission_id = s.id
      ),
      '[]'::json
    ) AS review_runs,
    COALESCE(
      (
        SELECT json_agg(
          jsonb_build_object(
            'id', aa.id,
            'action', aa.action,
            'notes', aa.notes,
            'createdAt', aa.created_at,
            'actedByName', u.full_name,
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
          ORDER BY aa.created_at DESC
        )
        FROM approval_actions aa
        JOIN users u ON u.id = aa.acted_by_user_id
        WHERE aa.approval_request_id = ar.id
      ),
      '[]'::json
    ) AS approval_actions
  FROM approval_requests ar
  JOIN submissions s ON s.id = ar.submission_id
  JOIN users su ON su.id = s.submitted_by_user_id
  JOIN users au ON au.id = ar.approver_user_id
  LEFT JOIN submission_media sm ON sm.submission_id = s.id
  WHERE ar.id = $1
  GROUP BY ar.id, s.id, su.id, au.id
`;

export async function loadApprovalRequestDetail({
  pool,
  approvalRequestId,
  enrichMediaCollection = (items) => items
}) {
  const result = await pool.query(approvalRequestDetailQuery, [approvalRequestId]);

  if (!result.rowCount) {
    return null;
  }

  return {
    ...result.rows[0],
    media: enrichMediaCollection(result.rows[0].media)
  };
}
