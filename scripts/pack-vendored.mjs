#!/usr/bin/env node
/**
 * Pack this source into the tarball the wallet installs.
 *
 * Run after `bun run build`. Runs scripts/check-package.mjs first and stops if
 * it fails. Writes `zzyzxlabs-super-chart-<version>.tgz` into
 * frontend/sup-wallet/vendor/ with `npm pack` — which packs exactly the
 * package.json `files`, and publishes nothing — then prints what else pins
 * that artifact, because a new tarball is not usable until they agree:
 *
 *   - frontend/sup-wallet/scripts/check-vendored-super-chart.mjs (sha256, and
 *     the file name if the version changed)
 *   - frontend/sup-wallet/vendor/README.md (sha256)
 *   - frontend/sup-wallet/apps/web/package.json and bun.lock (the file name,
 *     and bun.lock's integrity — re-run `bun install` in frontend/sup-wallet)
 *
 * Keep exactly one tarball in vendor/ (see its README). This script does not
 * delete the old one for you.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = resolve(root, "..", "sup-wallet", "vendor");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

if (!existsSync(join(root, "dist"))) {
  console.error("dist/ is missing — run `bun run build` in frontend/super-chart first.");
  process.exit(1);
}
// The package as a consumer gets it (exports, CSS path, Node import, d.ts
// parity, consumer type-check) must pass before it becomes the wallet's copy.
const checked = spawnSync(process.execPath, [join(root, "scripts", "check-package.mjs")], { cwd: root, stdio: "inherit" });
if (checked.status !== 0) {
  console.error("scripts/check-package.mjs failed; not packing.");
  process.exit(checked.status ?? 1);
}
const packed = spawnSync(`npm pack --pack-destination "${vendor}"`, { cwd: root, stdio: ["ignore", "pipe", "inherit"], shell: true });
if (packed.status !== 0) process.exit(packed.status ?? 1);
const name = `zzyzxlabs-super-chart-${pkg.version}.tgz`;
const bytes = readFileSync(join(vendor, name));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const sha512 = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
console.log(`packed ${name}\n  sha256 ${sha256}\n  ${sha512}`);
console.log("Now update the pins listed at the top of this script, then run `node scripts/check-vendored.mjs`.");
