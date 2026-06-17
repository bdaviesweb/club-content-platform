const assert = require("node:assert/strict");
const test = require("node:test");

const {
  demoLaunchActions,
  parseDemoLaunchAction
} = require("./demoLaunchActions");

test("parseDemoLaunchAction reads Expo Go load-demo URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082/--/demo/load"),
    demoLaunchActions.loadWorkspace
  );
});

test("parseDemoLaunchAction reads Expo Go create-demo-post URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082/--/demo/post"),
    demoLaunchActions.createPost
  );
});

test("parseDemoLaunchAction reads query-based create-demo-post URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082?demoAction=post"),
    demoLaunchActions.createPost
  );
});

test("parseDemoLaunchAction reads query-based review URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082?demoAction=review"),
    demoLaunchActions.openReview
  );
});

test("parseDemoLaunchAction reads Expo Go review URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082/--/demo/review"),
    demoLaunchActions.openReview
  );
});

test("parseDemoLaunchAction reads query-based first review URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082?demoAction=reviewFirst"),
    demoLaunchActions.openFirstReview
  );
});

test("parseDemoLaunchAction reads Expo Go first review URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082/--/demo/review-first"),
    demoLaunchActions.openFirstReview
  );
});

test("parseDemoLaunchAction reads query-based approve first review URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082?demoAction=approveFirstReview"),
    demoLaunchActions.approveFirstReview
  );
});

test("parseDemoLaunchAction reads Expo Go approve first review URLs", () => {
  assert.equal(
    parseDemoLaunchAction("exp://10.0.0.133:8082/--/demo/approve-first-review"),
    demoLaunchActions.approveFirstReview
  );
});

test("parseDemoLaunchAction ignores unrelated URLs", () => {
  assert.equal(parseDemoLaunchAction("exp://10.0.0.133:8082/--/status"), null);
});
