import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/** The icons, the web manifest and the link-preview picture hang together: what the page and the manifest name is there, at the size they say. */
const file = (path: string) => new URL(`../${path}`, import.meta.url)
const text = (path: string) => readFileSync(file(path), 'utf8')

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): string {
  const bytes = readFileSync(file(path))
  expect(bytes.subarray(1, 4).toString('latin1')).toBe('PNG')
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`
}

const html = text('index.html')
const linkTags = [...html.matchAll(/<link\s[^>]*>/g)].map((m) => m[0])
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

describe('index.html', () => {
  it('is Vanagram', () => {
    expect(html).toContain('<title>Vanagram — your campervan trip on one map</title>')
    expect(html).not.toMatch(/roadmap overview/i)
    expect(html).toMatch(/<meta property="og:site_name" content="Vanagram"/)
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/)
  })

  it('links every icon and the manifest from public/, with the size it says', () => {
    const icons = linkTags.filter((tag) => /rel="(icon|apple-touch-icon)"/.test(tag))
    expect(icons.map((tag) => attr(tag, 'href'))).toEqual(['/favicon-32.png', '/favicon-16.png', '/favicon.svg', '/apple-touch-icon.png'])
    for (const tag of icons) {
      const path = `public${attr(tag, 'href')}`
      expect(existsSync(file(path)), path).toBe(true)
      const sizes = attr(tag, 'sizes')
      if (path.endsWith('.png') && sizes) expect(pngSize(path)).toBe(sizes)
    }
    expect(pngSize('public/apple-touch-icon.png')).toBe('180x180')
    const manifest = linkTags.find((tag) => /rel="manifest"/.test(tag))
    expect(attr(manifest ?? '', 'href')).toBe('/manifest.webmanifest')
  })

  it('has a link preview picture of the size it declares', () => {
    expect(html).toMatch(/<meta property="og:image" content="\/og-image\.png"/)
    expect(html).toMatch(/<meta name="twitter:image" content="\/og-image\.png"/)
    const width = /og:image:width" content="(\d+)"/.exec(html)?.[1]
    const height = /og:image:height" content="(\d+)"/.exec(html)?.[1]
    expect(pngSize('public/og-image.png')).toBe(`${width}x${height}`)
    expect(`${width}x${height}`).toBe('1200x630')
  })

  it('has a theme colour for each scheme', () => {
    expect(html).toMatch(/name="theme-color" content="#ffffff" media="\(prefers-color-scheme: light\)"/)
    expect(html).toMatch(/name="theme-color" content="#161d28" media="\(prefers-color-scheme: dark\)"/)
  })
})

describe('manifest.webmanifest', () => {
  const manifest = JSON.parse(text('public/manifest.webmanifest')) as {
    name: string
    short_name: string
    start_url: string
    scope: string
    display: string
    theme_color: string
    background_color: string
    icons: { src: string; sizes: string; type: string; purpose?: string }[]
  }

  it('names the app and installs it standalone', () => {
    expect(manifest.name).toBe('Vanagram')
    expect(manifest.short_name).toBe('Vanagram')
    expect(manifest.display).toBe('standalone')
    expect(manifest.theme_color).toBe('#1a73e8')
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('has relative URLs, so it works under any sub-path (they resolve against the manifest)', () => {
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    for (const icon of manifest.icons) expect(icon.src).not.toMatch(/^\/|:/)
  })

  it('lists icons that exist at their size, with a maskable one apart from the plain ones', () => {
    expect(manifest.icons.map((icon) => [icon.src, icon.sizes, icon.purpose])).toEqual([
      ['icon-192.png', '192x192', 'any'],
      ['icon-512.png', '512x512', 'any'],
      ['icon-maskable-512.png', '512x512', 'maskable'],
    ])
    for (const icon of manifest.icons) {
      expect(icon.type).toBe('image/png')
      expect(pngSize(`public/${icon.src}`)).toBe(icon.sizes)
    }
  })
})

describe('the logo files', () => {
  it('serves the favicon that docs/brand makes (the generator writes both)', () => {
    expect(text('public/favicon.svg')).toBe(text('docs/brand/favicon.svg'))
  })

  it('has the favicon swap its design below 24 px, which only an image (not inline SVG) can use', () => {
    const svg = text('public/favicon.svg')
    expect(svg).toContain('@media (max-width:23.99px)')
    expect(svg).toContain('class="f32"')
    expect(svg).toContain('class="f16"')
  })

  it('keeps the PNG sizes the pages and the manifest rely on', () => {
    expect(pngSize('public/favicon-16.png')).toBe('16x16')
    expect(pngSize('public/favicon-32.png')).toBe('32x32')
    expect(pngSize('public/icon-192.png')).toBe('192x192')
  })
})
