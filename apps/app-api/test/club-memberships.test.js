import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedEditableRoles,
  canEditMembershipRole,
  canViewMemberships,
  describeMembershipChange,
  normalizeMembershipDraft,
  pickHighestMembershipRole
} from "../src/club-memberships.js";

test("club admins can edit all membership roles", () => {
  assert.deepEqual(allowedEditableRoles("club_admin"), [
    "submitter_parent",
    "submitter_player",
    "submitter_coach",
    "team_manager",
    "club_admin",
    "club_comms",
    "publisher"
  ]);
  assert.equal(canEditMembershipRole("club_admin", "club_admin"), true);
  assert.equal(canEditMembershipRole("club_admin", "club_comms"), true);
  assert.equal(canViewMemberships("club_admin"), true);
});

test("club comms can only edit non-admin roles", () => {
  assert.deepEqual(allowedEditableRoles("club_comms"), [
    "submitter_parent",
    "submitter_player",
    "submitter_coach",
    "team_manager",
    "publisher"
  ]);
  assert.equal(canEditMembershipRole("club_comms", "club_admin"), false);
  assert.equal(canEditMembershipRole("club_comms", "club_comms"), false);
  assert.equal(canEditMembershipRole("club_comms", "publisher"), true);
  assert.equal(canViewMemberships("club_comms"), true);
});

test("membership drafts normalize email and trim fields", () => {
  assert.deepEqual(
    normalizeMembershipDraft({
      email: "  Parent@Demo.Local  ",
      fullName: "  Riley Parent ",
      role: "submitter_parent",
      teamSlug: "  u14-girls  "
    }),
    {
      email: "parent@demo.local",
      fullName: "Riley Parent",
      role: "submitter_parent",
      teamSlug: "u14-girls"
    }
  );
});

test("highest role wins when an actor has multiple memberships", () => {
  assert.equal(
    pickHighestMembershipRole(["submitter_parent", "club_comms", "publisher"]),
    "club_comms"
  );
});

test("membership change summaries capture adds, removals, and updates", () => {
  const beforeRows = [
    {
      teamSlug: "u14-girls",
      role: "submitter_parent",
      email: "parent1@demo.local",
      fullName: "Parent One"
    },
    {
      teamSlug: null,
      role: "publisher",
      email: "publisher@demo.local",
      fullName: "Publisher One"
    }
  ];
  const afterRows = [
    {
      teamSlug: "u14-girls",
      role: "submitter_parent",
      email: "parent1@demo.local",
      fullName: "Parent One"
    },
    {
      teamSlug: "u15-boys",
      role: "submitter_parent",
      email: "parent2@demo.local",
      fullName: "Parent Two"
    },
    {
      teamSlug: null,
      role: "publisher",
      email: "publisher@demo.local",
      fullName: "Publisher Two"
    }
  ];

  assert.deepEqual(describeMembershipChange(beforeRows, afterRows), {
    added: [
      {
        teamSlug: "u15-boys",
        teamName: null,
        role: "submitter_parent",
        email: "parent2@demo.local",
        fullName: "Parent Two",
        membershipId: null,
        userId: null
      }
    ],
    removed: [],
    updated: [
      {
        before: {
          teamSlug: null,
          teamName: null,
          role: "publisher",
          email: "publisher@demo.local",
          fullName: "Publisher One",
          membershipId: null,
          userId: null
        },
        after: {
          teamSlug: null,
          teamName: null,
          role: "publisher",
          email: "publisher@demo.local",
          fullName: "Publisher Two",
          membershipId: null,
          userId: null
        }
      }
    ],
    counts: {
      added: 1,
      removed: 0,
      updated: 1
    }
  });
});
