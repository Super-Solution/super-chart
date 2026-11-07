import ts from 'typescript'
import { ESLint } from 'eslint'
import { resolve } from 'node:path'

// Lint the complete public runtime graph, including optional entries. Archived
// legacy modules are not part of the owned API or its TypeScript program.
const raw = ts.readConfigFile('tsconfig.json', ts.sys.readFile)
if (raw.error) throw new Error(ts.flattenDiagnosticMessageText(raw.error.messageText, '\n'))
const config = ts.parseJsonConfigFileContent(raw.config, ts.sys, process.cwd())
if (config.errors.length) throw new Error(config.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'))
const program = ts.createProgram(config.fileNames, config.options)
const prefix = resolve('packages').replaceAll('\\', '/') + '/'
const files = program.getSourceFiles().filter(file => !file.isDeclarationFile && file.fileName.replaceAll('\\', '/').startsWith(prefix) && /\/src\//.test(file.fileName)).map(file => file.fileName)
if (!files.length) throw new Error('No public runtime source files found')
const eslint = new ESLint()
const results = await eslint.lintFiles(files)
const formatter = await eslint.loadFormatter('stylish')
process.stdout.write(formatter.format(results))
const errors = results.reduce((total, file) => total + file.errorCount, 0)
const warnings = results.reduce((total, file) => total + file.warningCount, 0)
console.log(`Checked ${files.length} runtime files: ${errors} errors, ${warnings} warnings`)
// Preserve the existing warning budget; this changes scope, not lint severity.
if (errors || warnings > 380) process.exitCode = 1
