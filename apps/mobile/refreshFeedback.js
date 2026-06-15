function formatLastUpdatedLabel(value) {
  if (!value) return "Not refreshed yet";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not refreshed yet";

  return `Updated ${date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

function getRefreshButtonLabel(isRefreshing) {
  return isRefreshing ? "Refreshing" : "Refresh";
}

module.exports = {
  formatLastUpdatedLabel,
  getRefreshButtonLabel
};
