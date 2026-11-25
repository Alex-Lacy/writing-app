import { describe, expect, it } from 'vitest'
import { DEFAULT_RULES, DEFAULT_WORDLISTS } from './defaultRules'

// Small stand-alone parser, so this test checks the rule text independently of the filter engine.

function parseWordlists(text: string): Map<string, string> {
  const raw = new Map<string, string>()
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const m = /^([A-Z_]+)==\s*(.*)$/.exec(t)
    if (!m) throw new Error(`Bad wordlist line: ${t}`)
    raw.set(m[1], m[2].trim())
  }
  const expand = (s: string, seen: string[]): string =>
    s.replace(/%([A-Z_]+)%/g, (_, name: string) => {
      if (seen.includes(name)) throw new Error(`Cyclic wordlist: ${[...seen, name].join(' > ')}`)
      const body = raw.get(name)
      if (body === undefined) throw new Error(`Unknown wordlist %${name}%`)
      return `(?:${expand(body, [...seen, name])})`
    })
  const out = new Map<string, string>()
  for (const [name, body] of raw) out.set(name, expand(body, [name]))
  return out
}

interface Rule { id: string; description: string; patterns: RegExp[] }

function parseRules(text: string, lists: Map<string, string>): Rule[] {
  const rules: Rule[] = []
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith('#!')) {
      const m = /^#!\s*\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\s+(.+)$/.exec(t)
      if (!m) throw new Error(`Bad rule header: ${t}`)
      rules.push({ id: m[1], description: m[2], patterns: [] })
      continue
    }
    if (t.startsWith('#')) continue
    const m = /^\/(.+)\/([imsu]*)$/.exec(t)
    if (!m) throw new Error(`Bad pattern line: ${t}`)
    const rule = rules[rules.length - 1]
    if (!rule) throw new Error(`Pattern before any rule header: ${t}`)
    const src = m[1].replace(/%([A-Z_]+)%/g, (_, name: string) => {
      const body = lists.get(name)
      if (body === undefined) throw new Error(`Unknown wordlist %${name}% in ${rule.id}`)
      return `(?:${body})`
    })
    rule.patterns.push(new RegExp(src, m[2] + 'g'))
  }
  return rules
}

const lists = parseWordlists(DEFAULT_WORDLISTS)
const rules = parseRules(DEFAULT_RULES, lists)

function hits(text: string): string[] {
  const ids: string[] = []
  for (const r of rules) {
    for (const p of r.patterns) {
      p.lastIndex = 0
      if (p.test(text)) { ids.push(r.id); break }
    }
  }
  return ids
}

describe('default cliché rules', () => {
  it('parses, compiles and has unique ids', () => {
    expect(rules.length).toBeGreaterThanOrEqual(60)
    expect(rules.length).toBeLessThanOrEqual(120)
    const ids = rules.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const r of rules) expect(r.patterns.length, r.id).toBeGreaterThan(0)
  })

  it.each([
    ['shiver-spine', 'A shiver ran down her spine.'],
    ['shiver-spine', 'It sent shivers down his spine.'],
    ['testament-to', 'The garden was a testament to her patience.'],
    ['tapestry', 'The city was a rich tapestry of sound.'],
    ['barely-whisper', 'Her voice was barely above a whisper.'],
    ['maybe-just-maybe', 'Maybe, just maybe, they would make it.'],
    ['air-thick-with', 'The air was thick with tension.'],
    ['mix-of-emotions', 'She felt a mix of fear and excitement.'],
    ['felt-like-eternity', 'For what felt like an eternity, nobody moved.'],
    ['held-breath-unknowingly', "She let out a breath she didn't know she'd been holding."],
    ['not-just-but', "It wasn't just a house—it was a home."],
    ['not-just-but', 'This was not just a job, but a calling.'],
    ['not-x-it-was-y', "It wasn't fear. It was something worse."],
    ['staccato-fragments', 'He spoke. Slow. Deliberate. Final.'],
    ['repeated-opener', 'She walked to the door. She paused. She turned back.'],
    ['a-beat', '"Fine." A beat. "Actually, no."'],
    ['ghost-of-smile', 'The ghost of a smile touched his mouth.'],
    ['low-chuckle', 'He let out a low chuckle.'],
    ['voice-dripping-with', 'Her voice dripping with sarcasm, she agreed.'],
    ['eyes-sparkling-with', 'Her eyes sparkled with mischief.'],
    ['orbs', 'Her emerald orbs met his.'],
    ['distant-dog', 'Somewhere in the distance, a dog barked.'],
    ['first-time-long-time', 'For the first time in a long time, he slept.'],
    ['that-was-enough', 'And for now, that was enough.'],
    ['ministrations', 'She sighed under his ministrations.'],
    ['claimed-lips', 'He claimed her lips.'],
    ['moan-escaped', 'A soft moan escaped her lips.'],
    ['arched-into', 'She arched into his touch.'],
    ['pleasure-coursed', 'Pleasure coursed through her veins.'],
    ['stars-behind-eyes', 'Stars exploded behind her eyes.'],
    ['with-need', 'She was throbbing with need.'],
    ['possessive-mine', '"Mine," he growled.'],
    ['em-dash-cluster', 'She paused—just for a second—then—no—she went on.'],
  ])('%s matches: %s', (id, text) => {
    expect(hits(text)).toContain(id)
  })

  it.each([
    'She whispered his name.',
    'The coffee was hot.',
    'He walked to the window and looked out.',
    'Her eyes were green.',
    'It was not the red one but the blue one she wanted.',
    'He took a deep breath and opened the door.',
    'The wizard raised the glowing orbs above the altar.',
    'It was enough to buy bread for a week.',
    'The dog barked at the mailman.',
    'She smiled and handed him the keys.',
    'The room went quiet when the judge came in.',
    'They mixed flour and water in a bowl.',
  ])('ordinary prose does not match: %s', (text) => {
    expect(hits(text)).toEqual([])
  })
})
