#!/usr/bin/env bash
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-hermes-dev}"
REMOTE_DIR="${REMOTE_DIR:-/srv/repos/projects/club-content-platform}"
REQUIRE_EMAIL_DELIVERY="${REQUIRE_EMAIL_DELIVERY:-0}"
REQUIRE_PUSH_DELIVERY="${REQUIRE_PUSH_DELIVERY:-0}"
REQUIRE_CLEAN_QUEUE="${REQUIRE_CLEAN_QUEUE:-1}"
ALLOW_DEMO_IDENTITIES="${ALLOW_DEMO_IDENTITIES:-0}"
API_BASE_URL="${API_BASE_URL:-https://clubcontent-api.davmn.net}"

request_json() {
  curl -fsS "${API_BASE_URL}$1"
}

app_readiness="$(request_json "/app/readiness")"
notification_delivery_status="$(request_json "/notification-delivery/status")"
approval_queue="$(request_json "/approvals/queue")"
workflow_failed_events="$(request_json "/workflow-events")"

demo_org_slug="$(APP_READINESS="${app_readiness}" node -e 'const readiness = JSON.parse(process.env.APP_READINESS); process.stdout.write(readiness.demo?.organizationSlug || "demo-sports-org");')"
demo_club_slug="$(APP_READINESS="${app_readiness}" node -e 'const readiness = JSON.parse(process.env.APP_READINESS); process.stdout.write(readiness.demo?.clubSlug || "");')"
demo_team_slug="$(APP_READINESS="${app_readiness}" node -e 'const readiness = JSON.parse(process.env.APP_READINESS); process.stdout.write(readiness.demo?.teamSlug || "");')"

if [[ -z "${demo_club_slug}" ]]; then
  echo "Could not determine club slug from app readiness." >&2
  exit 1
fi

organization_directory="$(request_json "/organizations/${demo_org_slug}")"
organization_policy="$(request_json "/workflow-policies/organizations/${demo_org_slug}")"
club_policy="$(request_json "/workflow-policies/clubs/${demo_club_slug}")"

club_memberships="$(
  ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c \"select u.email, m.role from memberships m join users u on u.id=m.user_id where m.club_id=(select id from clubs where slug='${demo_club_slug}') order by u.email, m.role;\""
)"

organization_memberships="$(
  ssh "${REMOTE_HOST}" "cd '${REMOTE_DIR}' && docker compose -f docker-compose.vps.yml exec -T postgres psql -U club -d club_content -At -F '|' -c \"select u.email, om.role from organization_memberships om join users u on u.id=om.user_id where om.organization_id=(select id from organizations where slug='${demo_org_slug}') order by u.email, om.role;\""
)"

payload_dir="$(mktemp -d)"
cleanup_payload_dir() {
  rm -rf "${payload_dir}"
}
trap cleanup_payload_dir EXIT

printf '%s' "${app_readiness}" > "${payload_dir}/app_readiness.json"
printf '%s' "${notification_delivery_status}" > "${payload_dir}/notification_delivery_status.json"
printf '%s' "${approval_queue}" > "${payload_dir}/approval_queue.json"
printf '%s' "${workflow_failed_events}" > "${payload_dir}/workflow_failed_events.json"
printf '%s' "${organization_directory}" > "${payload_dir}/organization_directory.json"
printf '%s' "${organization_policy}" > "${payload_dir}/organization_policy.json"
printf '%s' "${club_policy}" > "${payload_dir}/club_policy.json"
printf '%s' "${club_memberships}" > "${payload_dir}/club_memberships.tsv"
printf '%s' "${organization_memberships}" > "${payload_dir}/organization_memberships.tsv"

node - "${payload_dir}" <<'NODE'
const fs = require("node:fs");

const payloadDir = process.argv[2];
const requireEmailDelivery = process.env.REQUIRE_EMAIL_DELIVERY === "1";
const requirePushDelivery = process.env.REQUIRE_PUSH_DELIVERY === "1";
const requireCleanQueue = process.env.REQUIRE_CLEAN_QUEUE !== "0";
const allowDemoIdentities = process.env.ALLOW_DEMO_IDENTITIES === "1";

const readJson = (name) =>
  JSON.parse(fs.readFileSync(`${payloadDir}/${name}`, "utf8"));
const readTsv = (name) =>
  fs
    .readFileSync(`${payloadDir}/${name}`, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [email, role] = line.split("|");
      return { email, role };
    });

const readiness = readJson("app_readiness.json");
const delivery = readJson("notification_delivery_status.json");
const queue = readJson("approval_queue.json");
const failedEvents = readJson("workflow_failed_events.json");
const organizationDirectory = readJson("organization_directory.json");
const organizationPolicy = readJson("organization_policy.json");
const clubPolicy = readJson("club_policy.json");
const clubMemberships = readTsv("club_memberships.tsv");
const organizationMemberships = readTsv("organization_memberships.tsv");

const blockers = [];
const warnings = [];

const clubSlug = clubPolicy?.club?.slug || readiness?.demo?.clubSlug || "unknown";
const orgSlug =
  organizationPolicy?.organization?.slug ||
  clubPolicy?.organization?.slug ||
  "unknown";
const teamSlug = readiness?.demo?.teamSlug || "unknown";

const effectivePolicy = clubPolicy?.effectivePolicy || {};
const defaultApproverRole = effectivePolicy.defaultApproverRole || null;
const videoApproverRole =
  effectivePolicy.routingRule?.contentTypeApprovers?.video || null;

const findMemberships = (items, role) =>
  items.filter((item) => item.role === role).map((item) => item.email);

const teamManagers = findMemberships(clubMemberships, "team_manager");
const clubComms = findMemberships(clubMemberships, "club_comms");
const clubAdmins = findMemberships(clubMemberships, "club_admin");
const orgAdmins = findMemberships(organizationMemberships, "organization_admin");

if (!organizationDirectory?.found) {
  blockers.push(`Organization ${orgSlug} was not found.`);
}

if (!clubPolicy?.found) {
  blockers.push(`Club ${clubSlug} was not found.`);
}

if (!orgAdmins.length) {
  blockers.push(`Organization ${orgSlug} has no organization_admin membership.`);
}

if (!clubComms.length) {
  blockers.push(`Club ${clubSlug} has no club_comms membership.`);
}

if (!clubAdmins.length) {
  blockers.push(`Club ${clubSlug} has no club_admin membership.`);
}

const needsTeamManager =
  defaultApproverRole === "team_manager" || videoApproverRole === "team_manager";
if (needsTeamManager && !teamManagers.length) {
  blockers.push(
    `Club ${clubSlug} routes to team_manager but no team_manager membership is assigned.`
  );
}

const demoEmails = [...clubMemberships, ...organizationMemberships]
  .map((item) => item.email)
  .filter((email) => /@demo-club\.local$|@demo-workspace\.local$/i.test(email));
if (!allowDemoIdentities && demoEmails.length) {
  blockers.push(
    `Demo identities are still assigned: ${[...new Set(demoEmails)].join(", ")}.`
  );
}

if (requireEmailDelivery && delivery?.email?.enabled !== true) {
  blockers.push(
    `Email delivery is not enabled. Current mode=${delivery?.email?.mode || "unknown"} reason=${delivery?.email?.reason || "unknown"}.`
  );
} else if (delivery?.email?.enabled !== true) {
  warnings.push(
    `Email delivery is not enabled. Current mode=${delivery?.email?.mode || "unknown"} reason=${delivery?.email?.reason || "unknown"}.`
  );
}

if (requirePushDelivery && delivery?.push?.enabled !== true) {
  blockers.push(
    `Push delivery is not enabled. Current mode=${delivery?.push?.mode || "unknown"} reason=${delivery?.push?.reason || "unknown"}.`
  );
} else if (delivery?.push?.enabled !== true) {
  warnings.push(
    `Push delivery is not enabled. Current mode=${delivery?.push?.mode || "unknown"} reason=${delivery?.push?.reason || "unknown"}.`
  );
}

if (requireCleanQueue && Array.isArray(queue?.items) && queue.items.length > 0) {
  blockers.push(`Approval queue is not clean. Pending items=${queue.items.length}.`);
}

if (Array.isArray(failedEvents?.items) && failedEvents.items.length > 0) {
  blockers.push(`Failed workflow events are present. Failed items=${failedEvents.items.length}.`);
}

console.log(`pilot_org_slug=${orgSlug}`);
console.log(`pilot_club_slug=${clubSlug}`);
console.log(`pilot_team_slug=${teamSlug}`);
console.log(`org_admin_count=${orgAdmins.length}`);
console.log(`club_admin_count=${clubAdmins.length}`);
console.log(`club_comms_count=${clubComms.length}`);
console.log(`team_manager_count=${teamManagers.length}`);
console.log(`default_approver_role=${defaultApproverRole || "n/a"}`);
console.log(`video_approver_role=${videoApproverRole || "n/a"}`);
console.log(`email_mode=${delivery?.email?.mode || "unknown"}`);
console.log(`push_mode=${delivery?.push?.mode || "unknown"}`);
console.log(`approval_queue_count=${Array.isArray(queue?.items) ? queue.items.length : 0}`);
console.log(`failed_workflow_count=${Array.isArray(failedEvents?.items) ? failedEvents.items.length : 0}`);

if (warnings.length) {
  for (const warning of warnings) {
    console.log(`warning=${warning}`);
  }
}

if (blockers.length) {
  console.log("activation_decision=NO_GO");
  for (const blocker of blockers) {
    console.log(`blocker=${blocker}`);
  }
  process.exit(1);
}

console.log("activation_decision=GO");
NODE
