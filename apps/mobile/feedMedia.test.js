const assert = require("node:assert/strict");
const test = require("node:test");

const { getClubFeedImagePreviewUrls, isImageMedia } = require("./feedMedia");

test("isImageMedia treats missing and image mime types as image media", () => {
  assert.equal(isImageMedia({}), true);
  assert.equal(isImageMedia({ mimeType: "image/jpeg" }), true);
  assert.equal(isImageMedia({ mimeType: "IMAGE/PNG" }), true);
  assert.equal(isImageMedia({ mimeType: "video/mp4" }), false);
});

test("getClubFeedImagePreviewUrls returns unique primary image previews", () => {
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
        id: "second-photo",
        media: [{ previewUrl: "https://uploads.test/c.png", mimeType: "image/png" }]
      }
    ]),
    ["https://uploads.test/a.jpg", "https://uploads.test/c.png"]
  );
});
