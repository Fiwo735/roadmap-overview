import { defineConfig, devices } from '@playwright/test'

// Several agents may run at once: always pass your own port, e.g. `E2E_PORT=5201 npm run e2e`.
const port = Number(process.env.E2E_PORT ?? 5199)
const origin = `http://127.0.0.1:${port}`

// With E2E_REAL_NETWORK=1 the browser reaches the real tile/OSRM/Nominatim servers, through the
// sandbox proxy when one is configured (loopback stays direct).
const proxyServer = process.env.HTTPS_PROXY ?? process.env.https_proxy
const proxy =
  process.env.E2E_REAL_NETWORK === '1' && proxyServer
    ? { server: proxyServer, bypass: 'localhost,127.0.0.1' }
    : undefined

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: origin,
    locale: 'en-US',
    colorScheme: 'light',
    viewport: { width: 1440, height: 900 },
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, launchOptions: { proxy } },
    },
  ],
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: origin,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
  },
})
