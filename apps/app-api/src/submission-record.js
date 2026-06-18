import { loadSubmissionBase } from "./submission-base.js";
import { buildSubmissionDetail } from "./submission-detail.js";
import { loadSubmissionWorkflowDetail } from "./submission-workflow-detail.js";

export async function loadSubmissionRecord({
  pool,
  submissionId,
  enrichMediaCollection
}) {
  const submission = await loadSubmissionBase({
    pool,
    submissionId,
    enrichMediaCollection
  });

  if (!submission) {
    return null;
  }

  const workflowDetail = await loadSubmissionWorkflowDetail({ pool, submissionId });

  return buildSubmissionDetail({
    submission,
    ...workflowDetail
  });
}
