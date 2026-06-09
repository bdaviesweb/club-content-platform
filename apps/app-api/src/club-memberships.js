export const membershipRoles = [
  "submitter_parent",
  "submitter_player",
  "submitter_coach",
  "team_manager",
  "club_admin",
  "club_comms",
  "publisher"
];

export const privilegedMembershipRoles = ["club_admin", "club_comms"];

export const editableMembershipRoles = membershipRoles.filter(
  (role) => !privilegedMembershipRoles.includes(role)
);

const membershipRolePriority = new Map([
  ["club_admin", 70],
  ["club_comms", 60],
  ["publisher", 50],
  ["team_manager", 40],
  ["submitter_coach", 30],
  ["submitter_player", 20],
  ["submitter_parent", 10]
]);

function normalizeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

export function normalizeMembershipRole(role) {
  const normalized = normalizeText(role);
  return membershipRoles.includes(normalized) ? normalized : null;
}

export function canViewMemberships(actorRole) {
  return privilegedMembershipRoles.includes(actorRole);
}

export function canEditMembershipRole(actorRole, targetRole) {
  if (actorRole === "club_admin") {
    return membershipRoles.includes(targetRole);
  }

  if (actorRole === "club_comms") {
    return editableMembershipRoles.includes(targetRole);
  }

  return false;
}

export function allowedEditableRoles(actorRole) {
  if (actorRole === "club_admin") {
    return [...membershipRoles];
  }

  if (actorRole === "club_comms") {
    return [...editableMembershipRoles];
  }

  return [];
}

export function pickHighestMembershipRole(roles) {
  let selectedRole = null;
  let selectedPriority = -1;

  for (const role of roles || []) {
    const priority = membershipRolePriority.get(role) || -1;
    if (priority > selectedPriority) {
      selectedPriority = priority;
      selectedRole = role;
    }
  }

  return selectedRole;
}

export function normalizeMembershipDraft(input) {
  const email = normalizeEmail(input?.email);
  const fullName = normalizeText(input?.fullName || input?.full_name);
  const role = normalizeMembershipRole(input?.role);
  const teamSlug = normalizeText(input?.teamSlug || input?.team_slug);

  if (!email || !fullName || !role) {
    return null;
  }

  return {
    email,
    fullName,
    role,
    teamSlug: teamSlug || null
  };
}

export function membershipKey({ teamSlug = null, role, email }) {
  return `${normalizeText(teamSlug).toLowerCase()}|${normalizeText(role)}|${normalizeEmail(email)}`;
}

function projectMembershipRow(row) {
  return {
    teamSlug: row.teamSlug || null,
    teamName: row.teamName || null,
    role: row.role,
    email: normalizeEmail(row.email),
    fullName: normalizeText(row.fullName || row.full_name),
    membershipId: row.membershipId || row.membership_id || row.id || null,
    userId: row.userId || row.user_id || null
  };
}

export function describeMembershipChange(beforeRows, afterRows) {
  const beforeByKey = new Map((beforeRows || []).map((row) => [membershipKey(row), projectMembershipRow(row)]));
  const afterByKey = new Map((afterRows || []).map((row) => [membershipKey(row), projectMembershipRow(row)]));

  const added = [];
  const removed = [];
  const updated = [];

  for (const [key, after] of afterByKey.entries()) {
    const before = beforeByKey.get(key);
    if (!before) {
      added.push(after);
      continue;
    }

    if (before.fullName !== after.fullName) {
      updated.push({ before, after });
    }
  }

  for (const [key, before] of beforeByKey.entries()) {
    if (!afterByKey.has(key)) {
      removed.push(before);
    }
  }

  return {
    added,
    removed,
    updated,
    counts: {
      added: added.length,
      removed: removed.length,
      updated: updated.length
    }
  };
}

export function normalizeMembershipRecord(row) {
  return {
    membershipId: row.membership_id || row.id || null,
    clubSlug: row.club_slug || null,
    clubName: row.club_name || null,
    teamId: row.team_id || null,
    teamSlug: row.team_slug || null,
    teamName: row.team_name || null,
    role: row.role,
    email: normalizeEmail(row.email),
    fullName: normalizeText(row.full_name),
    createdAt: row.created_at || null
  };
}
