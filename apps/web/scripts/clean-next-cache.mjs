import { rm } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

const retryableCodes = new Set(["EBUSY", "ENOTEMPTY", "EPERM"]);
const nextTargets = [
  "server",
  "static",
  "types",
  "cache/webpack",
  "app-build-manifest.json",
  "build-manifest.json",
  "package.json",
  "prerender-manifest.json",
  "react-loadable-manifest.json",
  "routes-manifest.json",
  "trace",
].map((target) => new URL(`../.next/${target}`, import.meta.url));

async function removeTarget(target) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      await rm(target, { force: true, maxRetries: 2, recursive: true, retryDelay: 200 });
      return;
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : "";
      const canRetry = retryableCodes.has(String(code));

      if (!canRetry || attempt === 6) {
        console.warn(
          `[dev] Could not clear ${target.pathname} (${String(
            code || "unknown"
          )}). Continuing; stop other Next processes if stale chunk errors appear.`
        );
        return;
      }

      await delay(250 * attempt);
    }
  }
}

for (const target of nextTargets) {
  await removeTarget(target);
}
