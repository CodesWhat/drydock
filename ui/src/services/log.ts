function getLogIcon() {
  return "fas fa-scroll";
}

async function getLog() {
  const response = await fetch("/api/log", { credentials: "include" });
  return response.json();
}

async function getLogEntries(options: { level?: string; component?: string; tail?: number; agent?: string } = {}) {
  const params = new URLSearchParams();
  if (options.level && options.level !== 'all') params.set('level', options.level);
  if (options.component) params.set('component', options.component);
  if (options.tail) params.set('tail', String(options.tail));
  const query = params.toString() ? '?' + params.toString() : '';
  const base = options.agent
    ? `/api/agents/${encodeURIComponent(options.agent)}/log/entries`
    : '/api/log/entries';
  const url = `${base}${query}`;
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to fetch log entries: ${response.statusText}`);
  }
  return response.json();
}

export { getLogIcon, getLog, getLogEntries };
