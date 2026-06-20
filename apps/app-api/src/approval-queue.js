const approvalQueueQuery = `
  SELECT
    ar.id,
    ar.state,
    ar.stage,
    ar.created_at,
    s.id AS submission_id,
    s.status AS submission_status,
    s.raw_text,
    s.risk_score,
    ar.approver_role AS "approverRole",
    s.routing_decision,
    u.full_name AS approver_name,
    rv.summary AS latest_review_summary
  FROM approval_requests ar
  JOIN submissions s ON s.id = ar.submission_id
  JOIN users u ON u.id = ar.approver_user_id
  LEFT JOIN LATERAL (
    SELECT summary
    FROM review_runs
    WHERE submission_id = s.id
    ORDER BY created_at DESC
    LIMIT 1
  ) rv ON TRUE
  WHERE ar.state = 'pending'
  ORDER BY ar.created_at ASC
`;

export async function loadApprovalQueue({ pool }) {
  const result = await pool.query(approvalQueueQuery);
  return result.rows;
}
