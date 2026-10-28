import { readFileSync } from 'node:fs'

const names = ['en-US', 'zh-CN', 'zh-TW']

// Keep the authored dictionaries complete. Only their built representation
// shares keys; lookup/registration still receive ordinary independent objects.
export function localeTablesModule (dictionaries) {
  if (dictionaries.length === 0) throw new Error('At least one built-in locale is required')
  const keys = Object.keys(dictionaries[0])
  const rows = dictionaries.map(dictionary => {
    if (Object.keys(dictionary).length !== keys.length || keys.some(key => !Object.hasOwn(dictionary, key) || typeof dictionary[key] !== 'string')) {
      throw new Error('Built-in locales must have identical keys and string values')
    }
    return keys.map(key => dictionary[key])
  })
  const list = values => values.length === 0 || values.some(value => value.includes('|'))
    ? JSON.stringify(values)
    : `${JSON.stringify(values.join('|'))}.split('|')`
  const groups = []
  for (let index = 0; index < keys.length;) {
    let prefix = keys[index]
    const next = keys[index + 1] ?? ''
    while (prefix.length > 0 && !next.startsWith(prefix)) prefix = prefix.slice(0, -1)
    // Tiny prefixes do not amortize the group punctuation and decoder.
    if (prefix.length < 4) prefix = ''
    let end = index + 1
    while (prefix !== '' && end < keys.length && keys[end].startsWith(prefix)) end++
    const previous = groups[groups.length - 1]
    if (prefix === '' && previous?.[0] === '') previous[1].push(keys[index])
    else groups.push([prefix, keys.slice(index, end).map(key => key.slice(prefix.length))])
    index = end
  }
  const groupedKeys = keys.some(key => key.includes('|')) ? list(keys)
    : `${JSON.stringify(groups.map(([prefix, suffixes]) => [prefix, suffixes.join('|')]))}
    .flatMap(([prefix, suffixes]) => suffixes.split('|').map(suffix => prefix + suffix))`
  return `const keys = ${groupedKeys};
export const locales = [${rows.map(list).join(',')}].map(row =>
  Object.fromEntries(keys.map((key, index) => [key, row[index]])));
`
}

export function compactLocales (sourceDirectory) {
  const source = sourceDirectory.replace(/\\/g, '/').replace(/\/$/, '')
  const ids = names.map(name => `${source}/i18n/${name}.json`)
  const tablesId = `${source}/i18n/compact-locale-tables.js`
  return {
    name: 'super-chart:compact-locales',
    apply: 'build',
    enforce: 'post',
    resolveId (id) {
      return id.replace(/\\/g, '/') === tablesId ? tablesId : undefined
    },
    load (id) {
      return id.replace(/\\/g, '/') === tablesId
        ? localeTablesModule(ids.map(file => JSON.parse(readFileSync(file, 'utf8'))))
        : undefined
    },
    transform (_code, id) {
      const index = ids.indexOf(id.replace(/\\/g, '/'))
      return index === -1 ? undefined : {
        code: `import { locales } from ${JSON.stringify(tablesId)}; export default locales[${index}];`,
        map: null
      }
    }
  }
}
