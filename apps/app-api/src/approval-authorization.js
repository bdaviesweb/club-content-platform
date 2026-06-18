export const reviewerRoles = ["club_comms", "club_admin"];

export function isReviewerRole(role) {
  return reviewerRoles.includes(String(role || "").trim());
}

export async function loadAuthorizedApprovalActor(client, approvalRequestId, actedByEmail) {
  const approvalRequest = await client.query(
    `
    SELECT
      ar.*,
      s.club_id,
      s.team_id,
      s.id AS submission_id,
      s.submitted_by_user_id,
      s.content_type,
      s.visibility_target
    FROM approval_requests ar
    JOIN submissions s ON s.id = ar.submission_id
    WHERE ar.id = $1
    FOR UPDATE
    `,
    [approvalRequestId]
  );

  if (!approvalRequest.rowCount) {
    return { found: false };
  }

  const actor = await client.query(
    `SELECT id, email FROM users WHERE email = $1`,
    [String(actedByEmail || "").trim()]
  );

  if (!actor.rowCount) {
    return {
      found: true,
      authorized: false,
      status: 404,
      error: `Unknown actedByEmail: ${actedByEmail}`
    };
  }

  const request = approvalRequest.rows[0];
  const allowedRoles = Array.from(
    new Set([request.approver_role, "club_admin"].filter(isReviewerRole))
  );

  if (!allowedRoles.length) {
    return {
      found: true,
      authorized: false,
      status: 403,
      error: "Approval request is not assigned to a reviewer role"
    };
  }

  const membership = await client.query(
    `
    SELECT id, role
    FROM memberships
    WHERE club_id = $1
      AND user_id = $2
      AND role = ANY($3::membership_role[])
      AND (
        team_id IS NULL
        OR team_id = $4
        OR $4::uuid IS NULL
      )
    ORDER BY
      CASE WHEN role = $5 THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1
    `,
    [
      request.club_id,
      actor.rows[0].id,
      allowedRoles,
      request.team_id,
      request.approver_role
    ]
  );

  if (!membership.rowCount) {
    return {
      found: true,
      authorized: false,
      status: 403,
      error: "Only assigned reviewers or club admins can act on this request"
    };
  }

  return {
    found: true,
    authorized: true,
    approvalRequest: request,
    actor: actor.rows[0],
    actorRole: membership.rows[0].role
  };
}
