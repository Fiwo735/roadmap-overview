import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { withSiteUrl } from './tools/sitePreview.ts'

const FLAGS_DIR = fileURLToPath(new URL('./node_modules/flag-icons/flags/4x3/', import.meta.url))

/**
 * Where the app is served from: `BASE_PATH=/vanagram/ npm run build` for a sub-path (GitHub Pages),
 * `/` otherwise. A leading and a trailing slash are added when missing. (`vite build --base=…` works too.)
 */
const BASE = `/${(process.env.BASE_PATH ?? '/').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/')

/**
 * The country flags (`src/features/stats/flags.ts`): the flag-icons SVGs are served at
 * `<base>/flags/<code>.svg` by the dev server and copied into the build, instead of going through the
 * bundler, which would inline the small ones into the JavaScript. The app only requests the flags it shows.
 */
function flagIcons(): Plugin {
  return {
    name: 'roadmap-flag-icons',
    configureServer(server) {
      // The dev server may run under a sub-path too: this middleware sees the URL with the base still on it.
      server.middlewares.use(`${server.config.base}flags`, (req, res, next) => {
        const code = /^\/([a-z]{2})\.svg$/.exec((req.url ?? '').split('?')[0])?.[1]
        if (!code) return next()
        try {
          const svg = readFileSync(`${FLAGS_DIR}${code}.svg`)
          res.setHeader('content-type', 'image/svg+xml')
          res.setHeader('cache-control', 'max-age=3600')
          res.end(svg)
        } catch {
          next()
        }
      })
    },
    generateBundle() {
      for (const file of readdirSync(FLAGS_DIR)) {
        this.emitFile({ type: 'asset', fileName: `flags/${file}`, source: readFileSync(`${FLAGS_DIR}${file}`) })
      }
    },
  }
}

/**
 * Link previews want an absolute image URL: with `VITE_SITE_URL` (the address the site is served at, e.g.
 * `https://example.com/vanagram`) the `og:image` and `twitter:image` of `index.html` get it, and `og:url` is added;
 * without it they stay paths under the base. The deploy workflow passes GitHub Pages' `base_url` (README, "Deployment").
 */
function sitePreview(siteUrl: string | undefined): Plugin {
  let base = BASE
  return {
    name: 'vanagram-site-preview',
    // The base the build really uses: `vite build --base=…` overrides the config's.
    configResolved(config) {
      base = config.base
    },
    transformIndexHtml: {
      // After Vite has put the base on the asset paths.
      order: 'post',
      handler(html) {
        const { html: page, url } = withSiteUrl(html, siteUrl, base)
        return { html: page, tags: url ? [{ tag: 'meta', attrs: { property: 'og:url', content: url }, injectTo: 'head' }] : [] }
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: BASE,
  plugins: [react(), flagIcons(), sitePreview(loadEnv(mode, process.cwd(), 'VITE_').VITE_SITE_URL)],
}))
