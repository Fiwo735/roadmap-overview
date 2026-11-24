import { describe, expect, it } from 'vitest'
import { siteRoot, withSiteUrl } from './sitePreview.ts'

const PAGE = `<head>
<meta property="og:title" content="Vanagram" />
<meta property="og:image" content="/roadmap-overview/og-image.png" />
<meta name="twitter:image" content="/roadmap-overview/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
</head>`

describe('siteRoot', () => {
  it('is null without a site URL', () => {
    expect(siteRoot(undefined)).toBeNull()
    expect(siteRoot('')).toBeNull()
    expect(siteRoot('  ')).toBeNull()
  })

  it('ends in a slash, whether or not the input does (GitHub Pages gives none)', () => {
    expect(siteRoot('https://example.com/roadmap-overview')).toBe('https://example.com/roadmap-overview/')
    expect(siteRoot('https://example.com/roadmap-overview/')).toBe('https://example.com/roadmap-overview/')
    expect(siteRoot(' https://example.com ')).toBe('https://example.com/')
  })

  it('drops a query and a fragment', () => {
    expect(siteRoot('https://example.com/app?x=1#top')).toBe('https://example.com/app/')
  })

  it('refuses what is not an http(s) URL, instead of publishing a broken preview', () => {
    expect(() => siteRoot('example.com/app')).toThrow(/VITE_SITE_URL/)
    expect(() => siteRoot('/roadmap-overview/')).toThrow(/VITE_SITE_URL/)
    expect(() => siteRoot('ftp://example.com/')).toThrow(/VITE_SITE_URL/)
  })
})

describe('withSiteUrl', () => {
  it('leaves the page alone without a site URL', () => {
    expect(withSiteUrl(PAGE, undefined, '/roadmap-overview/')).toEqual({ html: PAGE, url: null })
  })

  it('makes the og:image and twitter:image absolute on the site, not on the base', () => {
    const { html, url } = withSiteUrl(PAGE, 'https://example.com/roadmap-overview', '/roadmap-overview/')
    expect(url).toBe('https://example.com/roadmap-overview/')
    expect(html).toContain('<meta property="og:image" content="https://example.com/roadmap-overview/og-image.png" />')
    expect(html).toContain('<meta name="twitter:image" content="https://example.com/roadmap-overview/og-image.png" />')
    // Nothing else changes.
    expect(html).toContain('<meta property="og:title" content="Vanagram" />')
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image" />')
  })

  it('works for a site at a domain root and a build with the base "/"', () => {
    const page = PAGE.replaceAll('/roadmap-overview/', '/')
    expect(withSiteUrl(page, 'https://example.test', '/').html).toContain('content="https://example.test/og-image.png"')
  })

  it('takes a path that does not carry the base (a build without one) as relative to the site', () => {
    const page = PAGE.replaceAll('/roadmap-overview/', '/')
    expect(withSiteUrl(page, 'https://example.com/app', '/roadmap-overview/').html).toContain('content="https://example.com/app/og-image.png"')
  })
})
