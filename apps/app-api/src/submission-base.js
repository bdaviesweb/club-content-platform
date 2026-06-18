const submissionBaseQuery = `
  SELECT
    s.*,
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
    ) AS media
  FROM submissions s
  LEFT JOIN submission_media sm ON sm.submission_id = s.id
  WHERE s.id = $1
  GROUP BY s.id
`;

export async function loadSubmissionBase({
  pool,
  submissionId,
  enrichMediaCollection = (items) => items
}) {
  const result = await pool.query(submissionBaseQuery, [submissionId]);

  if (!result.rowCount) {
    return null;
  }

  return {
    ...result.rows[0],
    media: enrichMediaCollection(result.rows[0].media)
  };
}
