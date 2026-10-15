/**
 * route.fetch() runs on Playwright's own Node HTTP client, which pools
 * keep-alive connections and never expires them. The server closes an idle
 * connection six seconds after its last response, and a fetch that goes out
 * on a pooled connection right then fails with "socket hang up". A browser
 * resends such a request by itself. This client resends only when told to,
 * and then only after a connection reset, which is what this is.
 *
 * The containers page loads its list twice at once, so the second fetch takes
 * the older pooled connection, the one a previous page's pair left idle.
 */
const FETCH_OPTIONS = Object.freeze({ maxRetries: 2 });

/**
 * Fetch the request a route intercepted, for a handler that edits the response.
 * @param {import('@playwright/test').Route} route
 */
async function fetchIntercepted(route) {
  return route.fetch(FETCH_OPTIONS);
}

export { fetchIntercepted };
