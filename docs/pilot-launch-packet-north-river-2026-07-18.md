# Pilot Launch Packet

- Packet date: `2026-07-18`
- Candidate: `north-river-soccer-club-pilot`
- Launch mode: `dry run`
- Hosted SQL apply: `not executed`
- Decision: `GO for launch execution when the operator chooses to apply create SQL`
- Evidence path: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-real-launch/20260718T143805Z`
- Source bundle: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-real-launch/20260718T143805Z`
- Handoff file: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-real-launch/20260718T143805Z/handoff.md`
- Summary file: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-real-launch/20260718T143805Z/summary.txt`
- Status file: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-real-launch/20260718T143805Z/status.txt`
- Output packet: `/Users/robertdavies/Documents/Codex/club-content-platform/docs/pilot-launch-packet-north-river-2026-07-18.md`

## Portable Handoff

# Pilot Real Candidate Launch

- Onboarding path: `docs/pilot-onboarding-north-river-youth-sports.md`
- Candidate profile: `north-river-soccer-club-pilot`
- Candidate profile path: `/Users/robertdavies/Documents/Codex/club-content-platform/config/pilot-candidates/north-river-soccer-club-pilot.local.env`
- Creation plan: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-candidate-create-plan/20260718T143807Z-north-river-soccer-club-pilot/creation-plan.md`
- Create SQL: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-candidate-create-plan/20260718T143807Z-north-river-soccer-club-pilot/create.sql`
- Rollback SQL: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-candidate-create-plan/20260718T143807Z-north-river-soccer-club-pilot/rollback.sql`
- Create bundle: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-sql-apply/20260718T143809Z-north-river-soccer-club-pilot-create`
- Verify bundle: `/Users/robertdavies/Documents/Codex/club-content-platform/tmp/pilot-post-creation/20260718T143809Z-north-river-soccer-club-pilot`
- Rollback bundle: `<not run>`
- Rollback command: `PILOT_CANDIDATE_PROFILE=north-river-soccer-club-pilot npm run pilot:apply-sql -- north-river-soccer-club-pilot rollback`
- Decision: `GO`

## Recorded Status

```text
validate_onboarding=ok
prepare=ok
launch_readiness=ok
apply_create=ok
post_create_verify=ok
```

## Copy Notes

- Share this file as the single launch packet.
- The bundle path above points to the preserved evidence behind the packet.
- Blockers: none.
