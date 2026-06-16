const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getClubFeedImagePreviewUrls,
  getPrimaryClubFeedImagePreviewMedia,
  isImageMedia
} = require("./feedMedia");

test("isImageMedia treats missing and image mime types as image media", () => {
  assert.equal(isImageMedia({}), true);
  assert.equal(isImageMedia({ mimeType: "image/jpeg" }), true);
  assert.equal(isImageMedia({ mimeType: "IMAGE/PNG" }), true);
  assert.equal(isImageMedia({ mimeType: "video/mp4" }), false);
});

test("getClubFeedImagePreviewUrls returns unique first displayable image previews", () => {
  assert.deepEqual(
    getClubFeedImagePreviewUrls([
      { id: "no-media" },
      {
        id: "photo",
        media: [{ previewUrl: "https://uploads.test/a.jpg", mimeType: "image/jpeg" }]
      },
      {
        id: "duplicate",
        media: [{ previewUrl: "https://uploads.test/a.jpg", mimeType: "image/jpeg" }]
      },
      {
        id: "video",
        media: [{ previewUrl: "https://uploads.test/b.mp4", mimeType: "video/mp4" }]
      },
      {
        id: "fallback-photo",
        media: [
          { previewUrl: "https://uploads.test/c.mp4", mimeType: "video/mp4" },
          { previewUrl: "https://uploads.test/c.png", mimeType: "image/png" }
        ]
      }
    ]),
    ["https://uploads.test/a.jpg", "https://uploads.test/c.png"]
  );
});

test("getPrimaryClubFeedImagePreviewMedia skips unsupported primary media", () => {
  assert.deepEqual(
    getPrimaryClubFeedImagePreviewMedia({
      media: [
        { previewUrl: "https://uploads.test/a.mp4", mimeType: "video/mp4" },
        { previewUrl: "https://uploads.test/b.png", mimeType: "image/png" }
      ]
    }),
    { previewUrl: "https://uploads.test/b.png", mimeType: "image/png" }
  );
});
