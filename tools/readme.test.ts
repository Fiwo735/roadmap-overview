import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The README is the product's front page: it points at pictures that exist, at the live site, and says "road trip". */
const path = (p: string) => new URL(`../${p}`, import.meta.url)
const read = (p: string) => readFileSync(path(p), 'utf8')
const readme = read('README.md')

/** Every image the README shows, by its link (the `![…](…)` form). */
const images = [...readme.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g)].map((m) => m[1])

describe('README pictures', () => {
  it('are relative links to files that exist, each well under 500 kB', () => {
    expect(images.length).toBeGreaterThanOrEqual(6)
    for (const link of images) {
      expect(link, link).toMatch(/^docs\/screenshots\/[\w-]+\.(png|jpg)$/)
      expect(existsSync(path(link)), link).toBe(true)
      expect(statSync(path(link)).size, link).toBeLessThan(500 * 1024)
    }
  })

  it('are all the pictures docs/screenshots holds: no orphan is left behind', () => {
    const shown = new Set(images.map((l) => l.replace('docs/screenshots/', '')))
    expect(readdirSync(path('docs/screenshots')).sort()).toEqual([...shown].sort())
  })
})

describe('README text', () => {
  it('starts with the lockup, the road-trip tagline and the live site, in that order, then an intro paragraph', () => {
    const at = (text: string) => readme.indexOf(text)
    const live = 'https://filipwojcicki.com/vanagram/'
    expect(at('docs/brand/logo-lockup-light.svg')).toBeGreaterThan(-1)
    expect(at('Your road trip on one map.')).toBeGreaterThan(at('docs/brand/logo-lockup-light.svg'))
    expect(at(live)).toBeGreaterThan(at('Your road trip on one map.'))

    // The intro: the first paragraph of plain text after the live link, and before the first heading or picture.
    const afterLive = readme.slice(readme.indexOf('</p>', at(live)) + '</p>'.length)
    const intro = afterLive.split(/\n\s*\n/).map((block) => block.trim()).find((block) => block !== '')
    expect(intro, 'an intro paragraph').toBeDefined()
    expect(intro).not.toMatch(/^(<|!\[|#)/)
    expect(intro!.length).toBeGreaterThan(100)
    expect(readme.indexOf(intro!)).toBeLessThan(readme.indexOf('\n## '))
  })

  it('has no hosting, deployment or build history, and no table of contents or shortcut table', () => {
    for (const heading of ['Contents', 'Keyboard shortcuts', 'Hosting', 'Under a sub-path', 'Deployment', 'Name, logo and link previews']) {
      expect(readme, heading).not.toMatch(new RegExp(`^#+ ${heading}\\s*$`, 'm'))
    }
    expect(readme).not.toMatch(/github\.io|BASE_PATH|VITE_SITE_URL|GitHub Actions/)
    // How it was built, not what it is: a feature number in brackets, "done in F13", the Feature log, who reviewed it. (A key called F11 is fine.)
    expect(readme).not.toMatch(/\(F\d{1,2}\)|\b(done|added|made|built|fixed|introduced) in F\d|Feature log|[Rr]eviewed by|[Rr]eview(?:er)? found/)
  })

  it('names the repository as vanagram; the old name is only the file format id', () => {
    expect(readme).toContain('https://github.com/Fiwo735/vanagram.git')
    const old = readme.match(/roadmap-overview\/trip|roadmap-overview[\w-]*/g) ?? []
    expect(old.length).toBeGreaterThan(0)
    for (const hit of old) expect(hit).toBe('roadmap-overview/trip')
  })
})

describe('"road trip", not "campervan trip"', () => {
  it('is what the README, the page and the manifest say', () => {
    for (const file of ['README.md', 'index.html', 'public/manifest.webmanifest', 'docs/brand/src/compose.cjs']) {
      expect(read(file), file).not.toMatch(/campervan trip/i)
    }
    expect(read('public/manifest.webmanifest')).toContain('Your road trip on one map')
    expect(read('docs/brand/src/compose.cjs')).toContain('Your road trip on one map')
  })
})
