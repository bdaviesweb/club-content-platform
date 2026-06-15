async function buildApiError(response, fallbackLabel) {
  const status = response?.status || "unknown";
  let apiMessage = "";

  try {
    const payload = await response.json();
    apiMessage = typeof payload?.error === "string" ? payload.error.trim() : "";
  } catch (error) {
    apiMessage = "";
  }

  return new Error(apiMessage || `${fallbackLabel}: ${status}`);
}

module.exports = {
  buildApiError
};
