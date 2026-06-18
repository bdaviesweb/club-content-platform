export function buildWorkflowEventsWhereClause(status) {
  return status === "failed"
    ? "WHERE processed_at IS NOT NULL AND processing_error IS NOT NULL"
    : status === "pending"
      ? "WHERE processed_at IS NULL"
      : "";
}

export async function loadWorkflowEvents({ pool, status }) {
  const where = buildWorkflowEventsWhereClause(status);
  const result = await pool.query(
    `
    SELECT
      se.id,
      se.submission_id,
      se.event_name,
      se.payload,
      se.processed_at,
      se.processing_error,
      se.created_at,
      s.status AS submission_status,
      s.raw_text,
      s.caption_draft
    FROM submission_events se
    LEFT JOIN submissions s ON s.id = se.submission_id
    ${where}
    ORDER BY se.created_at DESC
    LIMIT 100
    `
  );

  return result.rows;
}
