import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSkillFile, parseSkillHeader, SkillFormatError } from '../skill-format.js'

function skill(
  header = 'name: fix-with-tests\ndescription: Fix bugs and add regression tests',
  body = '# Steps\n\nRead, fix, test.'
) {
  return `---\n${header}\n---\n${body}`
}

function errorCode(text: string, directoryName = 'fix-with-tests'): string {
  try {
    parseSkillFile(text, directoryName)
  } catch (error) {
    expect(error).toBeInstanceOf(SkillFormatError)
    expect((error as Error).message.length).toBeGreaterThan(0)
    return (error as SkillFormatError).code
  }
  throw new Error('Expected an explicit format error')
}

describe('strict Agent Skills frontmatter', () => {
  it('parses standard fields, preserves body structure, and does not authorize tools', () => {
    const parsed = parseSkillFile(
      skill(
        `name: fix-with-tests
description: >
  Fix bugs with tests.
  Use when repairing a regression.
license: MIT
compatibility: Requires Node.js 22+
metadata:
  author: zero2agent
  version: "1.0"
allowed-tools: Bash(git:*) Read`,
        '\n# Steps\n\n---\n\n1. Read.\n'
      ),
      'fix-with-tests'
    )
    expect(parsed.metadata).toEqual({
      name: 'fix-with-tests',
      description: 'Fix bugs with tests. Use when repairing a regression.',
      license: 'MIT',
      compatibility: 'Requires Node.js 22+',
      metadata: { author: 'zero2agent', version: '1.0' },
      allowedTools: 'Bash(git:*) Read',
      warnings: [expect.stringContaining('current permissions remain in force')],
    })
    expect(parsed.body).toBe('# Steps\n\n---\n\n1. Read.')
  })

  it('accepts BOM and CRLF; header parsing never treats the body as YAML', () => {
    const text = `\uFEFF${skill(undefined, 'BODY: [invalid YAML').replaceAll('\n', '\r\n')}`
    const parsed = parseSkillFile(text, 'fix-with-tests')
    expect(parsed.body).toBe('BODY: [invalid YAML')
    expect(parseSkillHeader(text, 'fix-with-tests')).toEqual(parsed.metadata)
  })

  it('accepts an EOF closing delimiter and an empty Markdown body', () => {
    expect(parseSkillFile(skill(undefined, '').trim(), 'fix-with-tests').body).toBe('')
  })

  it('uses complete delimiter lines, preserving hyphens and indented literal lines', () => {
    const parsed = parseSkillFile(
      skill('name: fix-with-tests\ndescription: |\n  foo---bar <x>\n  ---\n  tail'),
      'fix-with-tests'
    )
    expect(parsed.metadata.description).toBe('foo---bar <x>\n---\ntail')
  })

  it.each(['技能', 'мой-навык', 'café', '\u{10428}', '修复-123'])(
    'accepts Unicode name %s',
    name => {
      expect(
        parseSkillFile(skill(`name: ${name}\ndescription: Use this skill`), name).metadata.name
      ).toBe(name)
    }
  )

  it('normalizes name and directory independently with NFKC', () => {
    expect(parseSkillFile(skill('name: cafe\u0301\ndescription: Test'), 'café').metadata.name).toBe(
      'café'
    )
    expect(parseSkillFile(skill('name: fix\ndescription: Test'), 'ｆｉｘ').metadata.name).toBe(
      'fix'
    )
  })

  it.each([
    'PDF',
    'НАВЫК',
    '-fix',
    'fix-',
    'fix--tests',
    'fix_tests',
    'fix/tests',
    'fix tests',
    '😀',
    'a\u0305',
  ])('rejects malformed name %s', name => {
    expect(errorCode(skill(`name: "${name}"\ndescription: Test`), name)).toBe('invalid-name')
  })

  it('rejects directory mismatches after normalization', () => {
    expect(errorCode(skill(), 'other-name')).toBe('invalid-name')
  })

  it.each([63, 64, 65])('counts Unicode name code points at %i characters', count => {
    const name = '\u{10428}'.repeat(count)
    const text = skill(`name: ${name}\ndescription: Test`)
    if (count > 64) expect(errorCode(text, name)).toBe('invalid-name')
    else expect(parseSkillFile(text, name).metadata.name).toBe(name)
  })

  it.each([1023, 1024, 1025])('counts description code points at %i characters', count => {
    const description = '😀'.repeat(count)
    const text = skill(`name: fix-with-tests\ndescription: ${description}`)
    if (count > 1024) expect(errorCode(text)).toBe('invalid-description')
    else expect(parseSkillFile(text, 'fix-with-tests').metadata.description).toBe(description)
  })

  it.each([499, 500, 501])('counts compatibility code points at %i characters', count => {
    const compatibility = '😀'.repeat(count)
    const text = skill(`name: fix-with-tests\ndescription: Test\ncompatibility: ${compatibility}`)
    if (count > 500) expect(errorCode(text)).toBe('invalid-compatibility')
    else expect(parseSkillFile(text, 'fix-with-tests').metadata.compatibility).toBe(compatibility)
  })

  it.each(['name', 'description', 'compatibility'])(
    'enforces nonempty %s independently from YAML types',
    field => {
      for (const value of ['""', '"   "']) {
        const header = ['name: fix-with-tests', 'description: Test'].filter(
          line => !line.startsWith(`${field}:`)
        )
        header.push(`${field}: ${value}`)
        expect(errorCode(skill(header.join('\n')))).toBe(`invalid-${field}`)
      }
    }
  )

  it('accepts minimum required and compatibility lengths', () => {
    expect(
      parseSkillFile(skill('name: x\ndescription: y\ncompatibility: z'), 'x').metadata
    ).toMatchObject({ name: 'x', description: 'y', compatibility: 'z' })
  })

  it.each(['name', 'description'])('rejects missing required %s', field => {
    const header = ['name: fix-with-tests', 'description: Test'].filter(
      line => !line.startsWith(`${field}:`)
    )
    expect(errorCode(skill(header.join('\n')))).toBe(`invalid-${field}`)
  })

  it.each(['name', 'description', 'license', 'compatibility', 'allowed-tools'])(
    'rejects non-string %s without scalar coercion',
    field => {
      for (const value of ['null', 'true', '42', '[]', '{}']) {
        const header = ['name: fix-with-tests', 'description: Test'].filter(
          line => !line.startsWith(`${field}:`)
        )
        header.push(`${field}: ${value}`)
        expect(errorCode(skill(header.join('\n')))).toBe(`invalid-${field}`)
      }
    }
  )

  it.each(['null', '[]', 'author', '{version: 1}', '{1: "value"}', '{author: {name: example}}'])(
    'rejects invalid metadata mapping %s',
    value => {
      expect(errorCode(skill(`name: fix-with-tests\ndescription: Test\nmetadata: ${value}`))).toBe(
        'invalid-metadata'
      )
    }
  )

  it('keeps arbitrary string metadata as data, including prototype-like keys', () => {
    const parsed = parseSkillFile(
      skill(
        'name: fix-with-tests\ndescription: Test\nmetadata: {__proto__: "value", constructor: "other", version: "1"}'
      ),
      'fix-with-tests'
    )
    expect(Object.keys(parsed.metadata.metadata!)).toEqual(['__proto__', 'constructor', 'version'])
    expect(Object.getOwnPropertyDescriptor(parsed.metadata.metadata, '__proto__')?.value).toBe(
      'value'
    )
    expect(Object.getPrototypeOf(parsed.metadata.metadata)).toBe(Object.prototype)
  })

  it.each(['dependencies', 'disable-model-invocation', 'permission-mode', 'unknown'])(
    'explicitly rejects unsupported top-level %s',
    field => {
      expect(errorCode(skill(`name: fix-with-tests\ndescription: Test\n${field}: ignored`))).toBe(
        'unsupported-field'
      )
    }
  )

  it.each([
    '',
    '# Heading\nname: test',
    '\n---\nname: test\n---',
    '--- extra\nname: test\n---',
    '\uFEFF\uFEFF---\nname: test\n---',
  ])('requires an exact opening delimiter at start: %j', text => {
    expect(errorCode(text)).toBe('missing-frontmatter')
  })

  it.each(['---', '---\nname: fix-with-tests', '---\nname: fix-with-tests\n--- '])(
    'requires an exact closing delimiter: %j',
    text => {
      expect(errorCode(text)).toBe('unclosed-frontmatter')
    }
  )

  it.each([
    '',
    '- name\n- description',
    'one scalar',
    'null',
    '1: value',
    '? [name, other]\n: value',
  ])('requires a string-keyed mapping: %j', header => {
    expect(errorCode(skill(header))).toBe('invalid-frontmatter')
  })

  it.each([
    'name: fix-with-tests\nname: other\ndescription: Test',
    'name: fix-with-tests\ndescription: Test\nmetadata: {author: first, author: second}',
    'name: fix-with-tests\ndescription: Use when: fixing a bug',
    'name: [unterminated',
  ])('rejects duplicate keys and malformed YAML: %j', header => {
    expect(errorCode(skill(header))).toBe('invalid-yaml')
  })

  it.each([
    'name: &name fix-with-tests\ndescription: *name',
    'name: fix-with-tests\ndescription: *missing',
    'name: fix-with-tests\ndescription: !custom Test',
    'name: fix-with-tests\ndescription: !!timestamp 2026-01-01',
    'name: fix-with-tests\ndescription: Test\nmetadata: &loop {self: *loop}',
  ])('rejects anchors, aliases and custom tags: %j', header => {
    expect(errorCode(skill(header))).toBe('unsupported-yaml')
  })

  it('accepts standard explicit string tags', () => {
    expect(
      parseSkillFile(skill('name: !!str fix-with-tests\ndescription: !!str 123'), 'fix-with-tests')
        .metadata.description
    ).toBe('123')
  })

  it('validates the relocated CDP example using its matching directory name', () => {
    const text = readFileSync(
      new URL('../../../cdp-debug/skills/cdp-debug-node/SKILL.md', import.meta.url),
      'utf8'
    )
    const parsed = parseSkillFile(text, 'cdp-debug-node')
    expect(parsed.metadata.name).toBe('cdp-debug-node')
    expect(parsed.metadata.description).toContain('Programmatic Node.js debugging')
    expect(parsed.body).toContain('cdp-debug status')
  })
})
