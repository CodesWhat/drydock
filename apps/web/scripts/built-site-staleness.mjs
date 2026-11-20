import { readdirSync, statSync } from "node:fs";

// Newest mtime (ms) of any file under the given directories. Uses readdirSync with
// file types and one statSync per file, so there is no exists-then-read race.
export function newestMtimeMs(dirs) {
  let newest = 0;
  const stack = [...dirs];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) newest = Math.max(newest, statSync(path).mtimeMs);
    }
  }
  return newest;
}

// A build is stale when its BUILD_ID is older than the newest source file.
export function buildIsStale(buildIdMtimeMs, sourceMtimeMs) {
  return buildIdMtimeMs < sourceMtimeMs;
}

// Returns a skip reason when .next/BUILD_ID is missing or older than the sources, else false.
export function staleBuildReason(buildIdPath, sourceDirs) {
  let buildIdMtimeMs;
  try {
    buildIdMtimeMs = statSync(buildIdPath).mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT") return "no .next build (run `npm run build`)";
    throw error;
  }
  return buildIsStale(buildIdMtimeMs, newestMtimeMs(sourceDirs))
    ? "stale .next build, sources changed since it was built (run `npm run build`)"
    : false;
}
