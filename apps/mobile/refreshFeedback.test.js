const assert = require("node:assert/strict");
const test = require("node:test");

const {
  formatLastUpdatedLabel,
  getRefreshButtonLabel
} = require("./refreshFeedback");

test("formatLastUpdatedLabel falls back when refresh time is missing or invalid", () => {
  assert.equal(formatLastUpdatedLabel(null), "Not checked yet");
  assert.equal(formatLastUpdatedLabel("not-a-date"), "Not checked yet");
});

test("formatLastUpdatedLabel includes an updated time for valid values", () => {
  const label = formatLastUpdatedLabel(new Date("2026-06-15T01:09:34Z"));

  assert.match(label, /^Checked /);
  assert.match(label, /\d{1,2}:\d{2}:\d{2}/);
});

test("getRefreshButtonLabel reflects the current refresh state", () => {
  assert.equal(getRefreshButtonLabel(true), "Refreshing");
  assert.equal(getRefreshButtonLabel(false), "Refresh");
});
