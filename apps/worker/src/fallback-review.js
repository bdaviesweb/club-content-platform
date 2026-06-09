import { reviewThresholds } from "../../../packages/shared/src/index.js";

function clamp(number, min, max) {
  return Math.max(min, Math.min(number, max));
}

export function scoreRisk(rawText = "") {
  const text = rawText.toLowerCase();
  let score = 0.1;

  if (/(injury|hospital|broken|concussion)/.test(text)) {
    score += 0.35;
  }

  if (/(address|phone|email|contact)/.test(text)) {
    score += 0.25;
  }

  if (/(damn|hell|stupid|idiot)/.test(text)) {
    score += 0.2;
  }

  return clamp(score, 0, 0.99);
}

export function summarizeReview(rawText = "", riskScore) {
  if (!rawText) {
    return "No caption provided. Human review still required for publication decisions.";
  }

  if (riskScore >= reviewThresholds.highRisk) {
    return "High-risk language or sensitive details detected. Escalate to the review team.";
  }

  if (riskScore >= reviewThresholds.mediumRisk) {
    return "Some sensitive or lower-quality language detected. Route for normal approval.";
  }

  return "Low-risk submission. Safe to route for standard internal approval.";
}

export function draftCaption(rawText = "", submitterName = "Contributor") {
  if (rawText?.trim()) {
    return rawText.trim();
  }

  return `Workspace update submitted by ${submitterName}.`;
}
