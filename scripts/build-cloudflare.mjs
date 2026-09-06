import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Use Node directly so this command works on Windows and Linux alike.
const cli = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const result = spawnSync(process.execPath, [cli, "build"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  stdio: "inherit",
  env: { ...process.env, DEPLOY_TARGET: "cloudflare" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
