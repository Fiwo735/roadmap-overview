import { afterEach, describe, expect, it, vi } from 'vitest'
import { canCopyText, copyPng, copyText } from './deliver'

/** A ClipboardItem that remembers what it was given, and a clipboard that remembers what was written. */
function stubClipboard() {
  const written: Array<Record<string, unknown>> = []
  const texts: string[] = []
  class FakeClipboardItem {
    items: Record<string, unknown>
    constructor(items: Record<string, unknown>) {
      this.items = items
    }
  }
  vi.stubGlobal('ClipboardItem', FakeClipboardItem)
  vi.stubGlobal('navigator', {
    clipboard: {
      write: async (items: FakeClipboardItem[]) => {
        for (const item of items) written.push(item.items)
      },
      writeText: async (text: string) => {
        texts.push(text)
      },
    },
  })
  return { written, texts }
}

afterEach(() => vi.unstubAllGlobals())

describe('copyPng', () => {
  it('puts the image and nothing else on the clipboard: beside a picture, text would be pasted in its place', async () => {
    const { written } = stubClipboard()
    const png = Promise.resolve(new Blob(['png'], { type: 'image/png' }))
    await copyPng(png)
    expect(written).toHaveLength(1)
    expect(Object.keys(written[0])).toEqual(['image/png'])
    expect(written[0]['image/png']).toBe(png) // handed over as a promise: the write starts inside the click
  })
})

describe('copyText', () => {
  it('writes text and says whether it worked', async () => {
    const { texts } = stubClipboard()
    expect(canCopyText()).toBe(true)
    expect(await copyText('hello')).toBe(true)
    expect(texts).toEqual(['hello'])

    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: async () => {
          throw new Error('denied')
        },
      },
    })
    expect(await copyText('hello')).toBe(false)
  })

  it('is unavailable without a clipboard (an insecure page)', () => {
    vi.stubGlobal('navigator', {})
    expect(canCopyText()).toBe(false)
  })
})
