import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubmissionRequestBody,
  buildSubmissionText
} from "../src/submission-serialization.js";

test("buildSubmissionText preserves the expected posting order", () => {
  const text = buildSubmissionText(
    "Big win tonight",
    "goal, celebration, tournament",
    ["club-instagram", "club-facebook"],
    "Other",
    "Team outing",
    "Lakeville North",
    "3-1",
    "Shakopee"
  );

  assert.equal(
    text,
    [
      "Big win tonight",
      "Tags: goal, celebration, tournament",
      "Channels: club-instagram, club-facebook",
      "Event: Other - Team outing",
      "Opponent: Lakeville North",
      "Score: 3-1",
      "Location: Shakopee"
    ].join("\n")
  );
});

test("buildSubmissionRequestBody keeps the channel list and media shape intact", () => {
  const body = buildSubmissionRequestBody({
    clubSlug: "demo-soccer-club",
    teamSlug: "u14-girls",
    submitterEmail: "coach@demo-club.local",
    contentType: "photo",
    rawText: "Post body",
    selectedChannels: [" club-instagram ", "club-facebook", ""],
    visibilityTarget: "internal",
    objectKey: "uploads/post-1.jpg",
    mimeType: ""
  });

  assert.deepEqual(body, {
    clubSlug: "demo-soccer-club",
    teamSlug: "u14-girls",
    submitterEmail: "coach@demo-club.local",
    contentType: "photo",
    rawText: "Post body",
    selectedChannels: ["club-instagram", "club-facebook"],
    visibilityTarget: "internal",
    media: [
      {
        objectKey: "uploads/post-1.jpg",
        mediaType: "image",
        mimeType: "application/octet-stream"
      }
    ]
  });
});
