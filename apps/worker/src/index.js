import { setInterval } from "node:timers";
import { withTransaction } from "./db.js";
import {
  processSubmissionApproved,
  processSubmissionCreated
} from "./pipeline.js";
import { submissionEvents } from "../../../packages/shared/src/index.js";

const pollIntervalMs = 5000;

const handlers = {
  [submissionEvents.created]: processSubmissionCreated,
  [submissionEvents.approved]: processSubmissionApproved,
  [submissionEvents.routed]: async () => {},
  [submissionEvents.approvalRequested]: async () => {},
  [submissionEvents.published]: async () => {}
};

async function pollOnce() {
  const result = await withTransaction(async (client) => {
    const nextEvent = await client.query(
      `
      SELECT *
      FROM submission_events
      WHERE processed_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
      `
    );

    if (!nextEvent.rowCount) {
      return { processed: false };
    }

    const eventRow = nextEvent.rows[0];
    const handler = handlers[eventRow.event_name];

    if (!handler) {
      await client.query(
        `
        UPDATE submission_events
        SET processed_at = NOW(), processing_error = $2
        WHERE id = $1
        `,
        [eventRow.id, `No handler registered for ${eventRow.event_name}`]
      );

      return { processed: true, eventName: eventRow.event_name, skipped: true };
    }

    try {
      await handler(client, eventRow);
    } catch (error) {
      error.eventId = eventRow.id;
      throw error;
    }

    await client.query(
      `
      UPDATE submission_events
      SET processed_at = NOW(), processing_error = NULL
      WHERE id = $1
      `,
      [eventRow.id]
    );

    return { processed: true, eventName: eventRow.event_name };
  });

  return result;
}

async function markEventFailed(eventId, message) {
  await withTransaction(async (client) => {
    await client.query(
      `
      UPDATE submission_events
      SET processed_at = NOW(), processing_error = $2
      WHERE id = $1
      `,
      [eventId, message]
    );
  });
}

console.log("worker booted");
console.log(`poll interval: ${pollIntervalMs}ms`);

async function tick() {
  try {
    const result = await pollOnce();
    if (result.processed) {
      console.log("processed event", result);
    }
  } catch (error) {
    if (error?.eventId) {
      try {
        await markEventFailed(error.eventId, error.message);
      } catch (markError) {
        console.error("worker failed to mark event error", markError);
      }
    }
    console.error("worker error", error);
  }
}

await tick();
setInterval(tick, pollIntervalMs);
