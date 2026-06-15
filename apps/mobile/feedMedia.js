function isImageMedia(item) {
  const mimeType = String(item?.mimeType || "").toLowerCase();
  return !mimeType || mimeType.startsWith("image/");
}

function getClubFeedImagePreviewUrls(items) {
  const urls = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const primaryMedia = item?.media?.[0];
    const previewUrl = primaryMedia?.previewUrl;

    if (!previewUrl || !isImageMedia(primaryMedia) || seen.has(previewUrl)) {
      continue;
    }

    seen.add(previewUrl);
    urls.push(previewUrl);
  }

  return urls;
}

module.exports = {
  getClubFeedImagePreviewUrls,
  isImageMedia
};
