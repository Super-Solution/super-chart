import { resolve, posix } from 'node:path'

// Manual comparison only: never resolves the baseline from a moving branch.
const BASELINE = 'c8a8e9e098204f14ca7856a8bdc885c8ad9e814f'
const root = resolve(process.argv[2] ?? resolve(import.meta.dir, '../..'))
const baseline = process.argv[3] === '--baseline'
const entry = 'packages/bindings/web/src/workspace.ts'

/** Read Git's tar output in memory. No extracted tree, archive or build file is written. */
function baselineSources (): Map<string, string> {
  const result = Bun.spawnSync(['git', '-C', root, 'archive', '--format=tar', BASELINE, 'packages/core/src', 'packages/bindings/web/src'])
  if (result.exitCode !== 0) throw new Error(`Baseline ${BASELINE} must exist in local Git objects: ${result.stderr.toString()}`)
  const tar = Buffer.from(result.stdout), files = new Map<string, string>()
  let nextPath: string | null = null
  const text = (start: number, length: number): string => tar.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '')
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = text(offset, 100)
    if (name === '') break
    const size = Number.parseInt(text(offset + 124, 12).trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('Invalid Git baseline archive')
    const type = text(offset + 156, 1), prefix = text(offset + 345, 155)
    const body = tar.subarray(offset + 512, offset + 512 + size)
    if (type === 'x') {
      for (let start = 0; start < body.length;) {
        const separator = body.indexOf(32, start)
        const length = Number.parseInt(body.subarray(start, separator).toString(), 10)
        if (separator < start || !Number.isSafeInteger(length) || length <= separator - start + 1 || start + length > body.length) throw new Error('Invalid baseline extended header')
        const record = body.subarray(separator + 1, start + length - 1).toString('utf8')
        if (record.startsWith('path=')) nextPath = record.slice(5)
        start += length
      }
    } else if (type !== 'g') {
      const path = nextPath ?? (prefix === '' ? name : `${prefix}/${name}`)
      nextPath = null
      if ((type === '0' || type === '') && path.endsWith('.ts')) files.set(path, body.toString('utf8'))
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const plugins = baseline ? [{
  name: 'pinned-git-baseline',
  setup (builder: any) {
    const files = baselineSources()
    const find = (path: string): string => {
      const found = [path, `${path}.ts`, `${path}/index.ts`].find(candidate => files.has(candidate))
      if (found === undefined) throw new Error(`Missing ${BASELINE} source: ${path}`)
      return found
    }
    const relative = (path: string): string => path.replaceAll('\\', '/').slice(root.replaceAll('\\', '/').length + 1)
    builder.onResolve({ filter: /^@supersolutions\/super-chart-core$/ }, () => ({ path: resolve(root, find('packages/core/src/index.ts')) }))
    builder.onResolve({ filter: /^\./ }, (args: any) => ({ path: resolve(root, find(posix.normalize(posix.join(posix.dirname(relative(args.importer)), args.path)))) }))
    builder.onLoad({ filter: /\.ts$/ }, (args: any) => ({ contents: files.get(find(relative(args.path))), loader: 'ts' }))
  }
}] : [{
  name: 'workspace-core',
  setup (builder: any) {
    builder.onResolve({ filter: /^@supersolutions\/super-chart-core$/ }, () => ({ path: resolve(root, 'packages/core/src/index.ts') }))
  }
}]
const result = await Bun.build({ entrypoints: [resolve(root, entry)], target: 'browser', minify: true, write: false, plugins })
if (!result.success) throw new Error(result.logs.join('\n'))
process.stdout.write(await result.outputs[0].text())
