function getWatcherIcon() {
  return "fas fa-eye";
}

async function getAllWatchers() {
  const response = await fetch("/api/watchers", { credentials: "include" });
  return response.json();
}

export { getWatcherIcon, getAllWatchers };
