#!/usr/bin/env node
/**
 * The wallet's committed Super Chart tarball must be what THIS source builds.
 *
 * frontend/sup-wallet installs `@zzyzxlabs/super-chart` from a tarball
 * committed under `frontend/sup-wallet/vendor/` (so no install needs a
 * registry credential), and this directory is where that package's source
 * now lives. Two copies of one thing drift unless something compares them.
 * This compares every file in the tarball with the same file after
 * `bun run build` here, and fails on any difference.
 *
 * Usage (after `bun run build`):
 *   node scripts/check-vendored.mjs [path/to/package.tgz]
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Regular files in a (ustar/pax) tarball, by path. */
export function untar(buf) {
  const files = new Map();
  const field = (h, at, len) => h.subarray(at, at + len).toString("utf8").replace(/\0.*$/s, "");
  let off = 0;
  let paxPath;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const size = parseInt(field(h, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = field(h, 345, 155);
    const name = paxPath ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
    const body = buf.subarray(off + 512, off + 512 + size);
    paxPath = undefined;
    if (type === "x") {
      const m = body.toString("utf8").match(/^\d+ path=(.*)$/m);
      if (m) paxPath = m[1];
    } else if (type === "0") {
      files.set(name, Buffer.from(body));
    }
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

/** Every file under dist/, recursively (the ES build keeps one file per module). */
function listDist(dir, rel = "dist") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith("."))
    .flatMap((e) => (e.isDirectory() ? listDist(join(dir, e.name), `${rel}/${e.name}`) : [`${rel}/${e.name}`]))
    .sort();
}

function main() {
  const args = process.argv.slice(2);
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const tgz = args.find((a) => !a.startsWith("--")) ?? resolve(root, "..", "sup-wallet", "vendor", `zzyzxlabs-super-chart-${pkg.version}.tgz`);
  if (!existsSync(join(root, "dist"))) throw new Error("dist/ is missing — run `bun run build` in frontend/super-chart first.");
  if (!existsSync(tgz)) throw new Error(`no tarball at ${tgz} for version ${pkg.version}`);

  const entries = untar(gunzipSync(readFileSync(tgz)));
  const packed = new Map([...entries].filter(([n]) => n.startsWith("package/")).map(([n, b]) => [n.slice("package/".length), b]));
  const problems = [];

  const packedDist = [...packed.keys()].filter((n) => n.startsWith("dist/")).sort();
  const builtDist = listDist(join(root, "dist"));
  if (JSON.stringify(packedDist) !== JSON.stringify(builtDist)) {
    problems.push(`dist file lists differ: tarball [${packedDist.join(", ")}] vs build [${builtDist.join(", ")}]`);
  }
  for (const [rel, bytes] of packed) {
    const local = join(root, rel);
    if (!existsSync(local)) { problems.push(`${rel}: in the tarball, not in this directory`); continue; }
    const built = readFileSync(local);
    if (!bytes.equals(built)) problems.push(`${rel}: bytes differ`);
  }

  if (problems.length) {
    console.error(`${tgz} is not what frontend/super-chart builds:\n  - ${problems.join("\n  - ")}`);
    console.error("Rebuild and re-pack with scripts/pack-vendored.mjs, then update the sha256 pins it prints.");
    process.exit(1);
  }
  console.log(`vendored Super Chart ${pkg.version} matches this source: ${packed.size} files, byte-identical`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (err) { console.error(err.message); process.exit(1); }
}
