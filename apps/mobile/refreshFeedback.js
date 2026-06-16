function formatLastUpdatedLabel(value) {
  if (!value) return "Not checked yet";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not checked yet";

  return `Checked ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
  })}`;
}

function getRefreshButtonLabel(isRefreshing) {
  return isRefreshing ? "Refreshing" : "Refresh";
}

function getAutoRefreshLabel(isActive) {
  return isActive ? "Auto-refreshes while this view is open." : "Auto-refresh paused.";
}

module.exports = {
  getAutoRefreshLabel,
  formatLastUpdatedLabel,
  getRefreshButtonLabel
};
