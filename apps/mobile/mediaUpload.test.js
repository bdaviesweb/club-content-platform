const assert = require("node:assert/strict");
const test = require("node:test");

const { readAssetBlob, uploadSelectedAsset } = require("./mediaUpload");

test("readAssetBlob reads the selected asset through fetch", async () => {
  const blob = { size: 10 };
  const result = await readAssetBlob({ uri: "file:///tmp/photo.jpg" }, async (uri) => {
    assert.equal(uri, "file:///tmp/photo.jpg");
    return { blob: async () => blob };
  });

  assert.equal(result, blob);
});

test("readAssetBlob gives a recoverable message when local media cannot be read", async () => {
  await assert.rejects(
    readAssetBlob({ uri: "file:///tmp/missing.jpg" }, async () => {
      throw new Error("read binary failure");
    }),
    /Could not read selected media/
  );
});

test("uploadSelectedAsset PUTs the media blob to the signed URL", async () => {
  const calls = [];
  const blob = { size: 12, type: "image/jpeg" };

  await uploadSelectedAsset(
    {
      uploadUrl: "https://uploads.test/object",
      method: "PUT",
      headers: { "content-type": "image/jpeg" }
    },
    { uri: "file:///tmp/photo.jpg" },
    { fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url === "file:///tmp/photo.jpg") return { blob: async () => blob };
      return { status: 200 };
    } }
  );

  assert.deepEqual(calls, [
    { url: "file:///tmp/photo.jpg", options: undefined },
    {
      url: "https://uploads.test/object",
      options: {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: blob
      }
    }
  ]);
});

test("uploadSelectedAsset prefers Expo File body upload when provided", async () => {
  const calls = [];

  class TestFile {
    constructor(uri) {
      this.uri = uri;
    }
  }

  await uploadSelectedAsset(
    {
      uploadUrl: "https://uploads.test/object",
      method: "PUT",
      headers: { "content-type": "image/jpeg" }
    },
    { uri: "file:///tmp/photo.jpg" },
    {
      fileSystem: {
        File: TestFile
      },
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return { status: 200 };
      }
    }
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://uploads.test/object");
  assert.equal(calls[0].options.method, "PUT");
  assert.deepEqual(calls[0].options.headers, { "content-type": "image/jpeg" });
  assert.deepEqual(calls[0].options.body, new TestFile("file:///tmp/photo.jpg"));
});

test("uploadSelectedAsset uses fetch blob fallback without Expo File", async () => {
  const calls = [];
  const blob = { size: 12, type: "image/jpeg" };

  await uploadSelectedAsset(
    {
      uploadUrl: "https://uploads.test/object",
      method: "PUT",
      headers: { "content-type": "image/jpeg" }
    },
    { uri: "file:///tmp/photo.jpg" },
    {
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        if (url === "file:///tmp/photo.jpg") return { blob: async () => blob };
        return { status: 200 };
      }
    }
  );

  assert.deepEqual(calls, [
    { url: "file:///tmp/photo.jpg", options: undefined },
    {
      url: "https://uploads.test/object",
      options: {
        method: "PUT",
        headers: { "content-type": "image/jpeg" },
        body: blob
      }
    }
  ]);
});

test("uploadSelectedAsset reports non-2xx upload responses", async () => {
  await assert.rejects(
    uploadSelectedAsset(
      { uploadUrl: "https://uploads.test/object" },
      { uri: "file:///tmp/photo.jpg" },
      { fetchImpl: async (url) => {
        if (url === "file:///tmp/photo.jpg") return { blob: async () => ({}) };
        return { status: 403 };
      } }
    ),
    /Upload failed with status 403/
  );
});
