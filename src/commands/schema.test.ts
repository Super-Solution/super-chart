/**
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at

 * http://www.apache.org/licenses/LICENSE-2.0

 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import { COMMAND_DESCRIPTORS, findCommandDescriptor, getCommandDescriptors, validateAgainstSchema } from './schema'

describe('the DOM-free contract (SC-123)', () => {
  it('never imports klinecharts or solid-js — the whole point of the ./commands subpath', () => {
    const source = readFileSync(join(__dirname, 'schema.ts'), 'utf-8')
    expect(source).not.toMatch(/from ['"]klinecharts['"]/)
    expect(source).not.toMatch(/from ['"]solid-js/)
  })
})

describe('COMMAND_DESCRIPTORS', () => {
  it('has unique ids', () => {
    const ids = COMMAND_DESCRIPTORS.map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every example validates against its own schema (ajv-free)', () => {
    for (const descriptor of COMMAND_DESCRIPTORS) {
      const errors = validateAgainstSchema(descriptor.example, descriptor.argsSchema)
      expect({ id: descriptor.id, errors }).toEqual({ id: descriptor.id, errors: [] })
    }
  })

  it('getCommandDescriptors() and findCommandDescriptor() read the same registry', () => {
    expect(getCommandDescriptors()).toBe(COMMAND_DESCRIPTORS)
    expect(findCommandDescriptor('chart.setSymbol')?.id).toBe('chart.setSymbol')
    expect(findCommandDescriptor('not.a.command')).toBeUndefined()
  })

  it('a destructive command is flagged (drawing.clearAll, drawing.remove, annotation.clear, layout.apply, indicator.remove)', () => {
    const destructive = COMMAND_DESCRIPTORS.filter(c => c.destructive).map(c => c.id)
    expect(destructive).toEqual(expect.arrayContaining(['drawing.clearAll', 'drawing.remove', 'annotation.clear', 'layout.apply', 'indicator.remove']))
  })
})

describe('validateAgainstSchema', () => {
  const objectSchema = {
    type: 'object' as const,
    properties: { name: { type: 'string' as const, enum: ['a', 'b'] }, count: { type: 'number' as const, minimum: 0, maximum: 10 } },
    required: ['name'],
    additionalProperties: false
  }

  it('passes a valid value with no errors', () => {
    expect(validateAgainstSchema({ name: 'a', count: 5 }, objectSchema)).toEqual([])
  })

  it('flags a missing required property', () => {
    expect(validateAgainstSchema({}, objectSchema)).toEqual([{ path: 'name', message: 'required' }])
  })

  it('flags a value outside its enum', () => {
    const errors = validateAgainstSchema({ name: 'c' }, objectSchema)
    expect(errors).toHaveLength(1)
    expect(errors[0].path).toBe('name')
  })

  it('flags a value outside min/max', () => {
    expect(validateAgainstSchema({ name: 'a', count: -1 }, objectSchema)).toEqual([{ path: 'count', message: 'must be >= 0' }])
    expect(validateAgainstSchema({ name: 'a', count: 11 }, objectSchema)).toEqual([{ path: 'count', message: 'must be <= 10' }])
  })

  it('flags an unexpected property when additionalProperties is false', () => {
    const errors = validateAgainstSchema({ name: 'a', extra: 1 }, objectSchema)
    expect(errors.some(e => e.path === 'extra')).toBe(true)
  })

  it('flags a wrong top-level type without cascading noise', () => {
    expect(validateAgainstSchema('not-an-object', objectSchema)).toEqual([{ path: '(root)', message: 'expected object, got string' }])
  })

  it('validates array items', () => {
    const schema = { type: 'array' as const, items: { type: 'number' as const } }
    expect(validateAgainstSchema([1, 2, 3], schema)).toEqual([])
    expect(validateAgainstSchema([1, 'x', 3], schema)).toEqual([{ path: '[1]', message: 'expected number, got string' }])
  })

  it('an integer schema rejects a non-integer number', () => {
    expect(validateAgainstSchema(1.5, { type: 'integer' })).toEqual([{ path: '(root)', message: 'expected integer, got number' }])
    expect(validateAgainstSchema(2, { type: 'integer' })).toEqual([])
  })
})
