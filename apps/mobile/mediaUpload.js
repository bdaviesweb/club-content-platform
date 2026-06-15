async function readAssetBlob(selectedAsset, fetchImpl = fetch) {
  if (!selectedAsset?.uri) {
    throw new Error("Choose a photo or video before uploading.");
  }

  let response;
  try {
    response = await fetchImpl(selectedAsset.uri);
  } catch (error) {
    throw new Error("Could not read selected media. Choose the file again.");
  }

  if (!response || typeof response.blob !== "function") {
    throw new Error("Could not read selected media. Choose the file again.");
  }

  try {
    return await response.blob();
  } catch (error) {
    throw new Error("Could not read selected media. Choose the file again.");
  }
}

async function uploadSelectedAsset(uploadPlan, selectedAsset, options = {}) {
  if (!uploadPlan?.uploadUrl) {
    throw new Error("Upload signing returned no upload URL.");
  }

  const fileSystem = options.fileSystem;
  const fetchImpl = options.fetchImpl || fetch;
  const method = uploadPlan.method || "PUT";
  const headers = uploadPlan.headers || {};

  if (fileSystem?.File && selectedAsset?.uri) {
    const assetFile = new fileSystem.File(selectedAsset.uri);
    const uploadResponse = await fetchImpl(uploadPlan.uploadUrl, {
      method,
      headers,
      body: assetFile
    });

    if (!uploadResponse || uploadResponse.status < 200 || uploadResponse.status >= 300) {
      throw new Error(`Upload failed with status ${uploadResponse?.status || "unknown"}`);
    }
    return;
  }

  const assetBlob = await readAssetBlob(selectedAsset, fetchImpl);
  const uploadResponse = await fetchImpl(uploadPlan.uploadUrl, {
    method,
    headers,
    body: assetBlob
  });

  if (!uploadResponse || uploadResponse.status < 200 || uploadResponse.status >= 300) {
    throw new Error(`Upload failed with status ${uploadResponse?.status || "unknown"}`);
  }
}

module.exports = {
  readAssetBlob,
  uploadSelectedAsset
};
