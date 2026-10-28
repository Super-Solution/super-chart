#!/usr/bin/env node
/**
 * Super Chart stays private (owner decision, 2026-09-25).
 *
 * It is published only to GitHub Packages, which is private for this
 * organisation's private repositories; Broker web installs it from there.
 * Until this directory became the source of truth, the SUPer-Chart repository
 * also carried `npm-publish.yml`, which ran `npm publish --access=public` to
 * registry.npmjs.org whenever anyone created a GitHub Release. That file is
 * gone; this check keeps anything like it from coming back.
 *
 * `"private": true` is NOT the guard, deliberately: it makes `npm publish`
 * refuse every registry, including the private one Broker depends on.
 *
 * Fails when:
 *   - package.json publishes anywhere but https://npm.pkg.github.com, or with
 *     `access: public`;
 *   - a workflow, script or package.json names the public registry or a
 *     public-access publish.
 *
 * Usage: node scripts/check-private.mjs [--self-test]
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const self = fileURLToPath(import.meta.url);
const PRIVATE_REGISTRY = "https://npm.pkg.github.com";
const PUBLIC = [/registry\.npmjs\.org/i, /--access[=\s]+public/i, /"access"\s*:\s*"public"/i];

/** Problems for one package.json object plus the text files that can publish it. */
export function findProblems(pkg, files) {
  const problems = [];
  const registry = pkg.publishConfig?.registry;
  if (registry !== PRIVATE_REGISTRY) problems.push(`package.json publishConfig.registry must be ${PRIVATE_REGISTRY}; found ${JSON.stringify(registry)}`);
  if (pkg.publishConfig?.access === "public") problems.push("package.json publishConfig.access is \"public\"");
  for (const [path, text] of files) {
    for (const pattern of PUBLIC) {
      if (pattern.test(text)) problems.push(`${path} matches ${pattern}`);
    }
  }
  return problems;
}

function textFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? textFiles(full) : [full];
  });
}

function selfTest() {
  const good = { publishConfig: { registry: PRIVATE_REGISTRY } };
  const cases = [
    ["clean", good, [], 0],
    ["no publishConfig", {}, [], 1],
    ["public registry in package.json", { publishConfig: { registry: "https://registry.npmjs.org/" } }, [], 1],
    ["public access", { publishConfig: { registry: PRIVATE_REGISTRY, access: "public" } }, [], 1],
    ["the old npm-publish.yml", good, [["npm-publish.yml", "registry-url: https://registry.npmjs.org/\n- run: npm publish --access=public"]], 2],
    ["a script with --access public", good, [["release.sh", "npm publish --access public"]], 1],
  ];
  for (const [name, pkg, files, expected] of cases) {
    const found = findProblems(pkg, files).length;
    if (found !== expected) throw new Error(`self-test "${name}": expected ${expected} problem(s), found ${found}`);
  }
  console.log(`check-private self-test passed (${cases.length} cases)`);
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const pkgText = readFileSync(join(root, "package.json"), "utf8");
  const files = [join(root, "package.json"), ...textFiles(join(root, ".github")), ...textFiles(join(root, "scripts"))]
    .filter((f) => f !== self)
    .map((f) => [relative(root, f).split("\\").join("/"), readFileSync(f, "utf8")]);
  const problems = findProblems(JSON.parse(pkgText), files);
  if (problems.length) {
    console.error(`Super Chart must stay private:\n  - ${problems.join("\n  - ")}`);
    process.exit(1);
  }
  console.log(`Super Chart publishes only to ${PRIVATE_REGISTRY} (${files.length} files checked)`);
}

try { main(); } catch (err) { console.error(err.message); process.exit(1); }
