/**
 * File name of one preserved module in the ES build (vite.config.ts,
 * output.entryFileNames), from Rollup's chunk name.
 *
 * Modules under src/ arrive relative to src/ (preserveModulesRoot) and keep
 * that path. Inlined dependencies (solid-js) go under vendor/, never
 * dist/node_modules/, which some pack tools drop. Rollup names a dependency
 * after its path: "node_modules/solid-js/web/dist/web" when node_modules sits
 * in this package, but an ABSOLUTE path when node_modules resolves elsewhere (a
 * junction or symlink, a hoisted workspace install, pnpm's store), and Rollup
 * refuses an absolute file name. So everything up to the last node_modules/
 * segment is dropped, whatever the layout.
 *
 * @param {string} name Rollup's chunk name, without extension.
 * @returns {string} A relative file name ending in ".js".
 */
export function entryFileName(name) {
  const path = name.replace(/\\/g, "/");
  const dependency = /(?:^|\/)node_modules\/(?!.*\/node_modules\/)(.+)$/.exec(path);
  const out = dependency !== null ? `vendor/${dependency[1]}` : path;
  if (/^(?:\/|[A-Za-z]:\/)/.test(out) || out.split("/").includes("..")) {
    throw new Error(`super-chart build: a module outside src/ and node_modules/ has no place in dist/: ${name}`);
  }
  return `${out}.js`;
}
