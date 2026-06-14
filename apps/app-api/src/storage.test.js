import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPublicObjectUrl,
  buildUploadObjectKey,
  isDisplayPreviewMimeType,
  validateUploadRequest
} from "./storage.js";

test("validates and normalizes signed upload requests", () => {
  const result = validateUploadRequest({
    clubSlug: " demo-club ",
    files: [
      {
        mediaType: "PHOTO",
        mimeType: " IMAGE/JPEG ",
        filename: "goal.jpg"
      },
      {
        mediaType: "video",
        mimeType: "video/mp4",
        filename: "clip.mp4"
      }
    ]
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.value, {
    clubSlug: "demo-club",
    files: [
      {
        mediaType: "photo",
        mimeType: "image/jpeg",
        filename: "goal.jpg"
      },
      {
        mediaType: "video",
        mimeType: "video/mp4",
        filename: "clip.mp4"
      }
    ]
  });
});

test("rejects missing upload request fields", () => {
  assert.deepEqual(validateUploadRequest({}), {
    valid: false,
    error: "clubSlug and a non-empty files array are required"
  });

  assert.deepEqual(validateUploadRequest({ clubSlug: "demo", files: [] }), {
    valid: false,
    error: "clubSlug and a non-empty files array are required"
  });
});

test("rejects unsupported media and mismatched mime types", () => {
  assert.deepEqual(
    validateUploadRequest({
      clubSlug: "demo",
      files: [{ mediaType: "document", mimeType: "application/pdf", filename: "waiver.pdf" }]
    }),
    {
      valid: false,
      error: "files[0].mediaType must be photo or video"
    }
  );

  assert.deepEqual(
    validateUploadRequest({
      clubSlug: "demo",
      files: [{ mediaType: "photo", mimeType: "video/mp4", filename: "clip.mp4" }]
    }),
    {
      valid: false,
      error: "files[0].mimeType must match the media type"
    }
  );

  assert.deepEqual(
    validateUploadRequest({
      clubSlug: "demo",
      files: [{ mediaType: "photo", mimeType: "image/heic", filename: "sideline.heic" }]
    }),
    {
      valid: false,
      error: "files[0].mimeType must be image/jpeg, image/png, or image/webp for photos"
    }
  );
});

test("limits the number of files signed in one request", () => {
  const result = validateUploadRequest({
    clubSlug: "demo",
    files: Array.from({ length: 7 }, (_, index) => ({
      mediaType: "photo",
      mimeType: "image/jpeg",
      filename: `photo-${index}.jpg`
    }))
  });

  assert.deepEqual(result, {
    valid: false,
    error: "At most 6 files can be signed at once"
  });
});

test("builds sanitized upload object keys", () => {
  const objectKey = buildUploadObjectKey({
    clubSlug: "../demo club/",
    filename: "../goal photo!.jpg",
    timestamp: 123,
    id: "fixed-id"
  });

  assert.equal(
    objectKey,
    "uploads/demo-club/123-fixed-id-goal-photo-.jpg"
  );
});

test("builds API media preview URLs when public app URL is configured", () => {
  const originalPublicAppUrl = process.env.PUBLIC_APP_URL;
  process.env.PUBLIC_APP_URL = "https://clubcontent-api.davmn.net";

  try {
    assert.equal(
      buildPublicObjectUrl("uploads/demo club/photo 1.jpg"),
      "https://clubcontent-api.davmn.net/media/preview?key=uploads%2Fdemo%20club%2Fphoto%201.jpg"
    );
  } finally {
    if (originalPublicAppUrl === undefined) {
      delete process.env.PUBLIC_APP_URL;
    } else {
      process.env.PUBLIC_APP_URL = originalPublicAppUrl;
    }
  }
});

test("identifies feed-displayable preview mime types", () => {
  assert.equal(isDisplayPreviewMimeType("image/jpeg"), true);
  assert.equal(isDisplayPreviewMimeType(" image/png "), true);
  assert.equal(isDisplayPreviewMimeType("video/mp4"), true);
  assert.equal(isDisplayPreviewMimeType("image/heic"), false);
});
