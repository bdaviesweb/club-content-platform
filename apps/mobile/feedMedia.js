function isImageMedia(item) {
  const mimeType = String(item?.mimeType || "").toLowerCase();
  return !mimeType || mimeType.startsWith("image/");
}

function getPrimaryClubFeedImagePreviewMedia(item) {
  for (const mediaItem of Array.isArray(item?.media) ? item.media : []) {
    if (mediaItem?.previewUrl && isImageMedia(mediaItem)) {
      return mediaItem;
    }
  }

  return null;
}

function getClubFeedImagePreviewUrls(items) {
  const urls = [];
  const seen = new Set();

  for (const item of Array.isArray(items) ? items : []) {
    const previewMedia = getPrimaryClubFeedImagePreviewMedia(item);
    const previewUrl = previewMedia?.previewUrl;

    if (!previewUrl || seen.has(previewUrl)) {
      continue;
    }

    seen.add(previewUrl);
    urls.push(previewUrl);
  }

  return urls;
}

module.exports = {
  getClubFeedImagePreviewUrls,
  getPrimaryClubFeedImagePreviewMedia,
  isImageMedia
};
