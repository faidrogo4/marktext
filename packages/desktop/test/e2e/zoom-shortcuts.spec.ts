import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { enterSourceMode, expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer, waitForMenuReady } from './helpers'

const markdown = '# Zoom test\n\nDocument text\n'

test.describe('zoom keyboard shortcuts', () => {
  let app: ElectronApplication
  let page: Page

  const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor())

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
    app = launched.app
    page = launched.page
    await waitForMenuReady(app)
    await page.locator('.mu-paragraph-content').last().click()
  })

  test.afterEach(async() => {
    if (app) {
      try { await expectNoRendererErrors(app) } finally { await app.close() }
    }
  })

  const press = (keyCode: string, shift = false) => app.evaluate(({ BrowserWindow }, { keyCode, shift }) => {
    const modifiers: Array<'control' | 'shift'> = shift ? ['control', 'shift'] : ['control']
    const webContents = BrowserWindow.getAllWindows()[0].webContents
    webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
  }, { keyCode, shift })

  const checkKeys = async() => {
    for (const [key, shift] of [['+', true], ['=', false]] as const) {
      await press(key, shift)
      await expect.poll(zoom).toBe(1.125)
      await press('-')
      await expect.poll(zoom).toBe(1)
    }
  }

  test('plus, equals and minus keys zoom without editing the document', async() => {
    await checkKeys()
    await expect(page.locator('.editor-component')).toContainText('Document text')
    const content = await page.locator('.editor-component .mu-container').evaluate((root) => {
      const block = (root as Element & { __MUYA_BLOCK__: { muya: { getMarkdown(): string } } }).__MUYA_BLOCK__
      return block.muya.getMarkdown().trim()
    })
    expect(content).toBe(markdown.trim())
  })

  test('the same shortcuts work while typing in source mode', async() => {
    await enterSourceMode(page, app)
    await page.locator('.source-code .CodeMirror').click()
    await checkKeys()
    await expect(page.locator('.source-code .CodeMirror')).toContainText('Document text')
    const content = await page.locator('.editor-component .mu-container').evaluate((root) => {
      const block = (root as Element & { __MUYA_BLOCK__: { muya: { getMarkdown(): string } } }).__MUYA_BLOCK__
      return block.muya.getMarkdown().trim()
    })
    expect(content).toBe(markdown.trim())
  })

  test('either split pane can zoom the window', async() => {
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'Second document\n')
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    await page.evaluate(() => {
      const root = document.querySelector('#app') as Element & {
        __vue_app__: {
          config: {
            globalProperties: {
              $pinia: {
                _s: Map<string, {
                  tabs: Array<{ id: string }>
                  START_SPLIT_VIEW(value: { tabId: string; otherTabId: string; direction: string }): void
                }>
              }
            }
          }
        }
      }
      const store = root.__vue_app__.config.globalProperties.$pinia._s.get('editor')!
      store.START_SPLIT_VIEW({ tabId: store.tabs[0].id, otherTabId: store.tabs[1].id, direction: 'vertical' })
    })
    await expect(page.locator('.editor-pane')).toHaveCount(2)
    for (const pane of [0, 1]) {
      await page.locator('.editor-pane').nth(pane).locator('.mu-paragraph-content').last().click()
      await checkKeys()
    }
    await expect(page.locator('.editor-pane').nth(0)).toContainText('Document text')
    await expect(page.locator('.editor-pane').nth(1)).toContainText('Second document')
  })
})
