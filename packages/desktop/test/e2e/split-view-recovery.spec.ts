import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import { expectNoRendererErrors, launchWithMarkdown, sendIpcToRenderer } from './helpers'

const alpha = '# Daily notes\n\n- [ ] First task\n  - [ ] Nested task\n- [x] Last task\n\nAlpha text\n'
const beta = '# Journal\n\nBeta text\n'

const runStore = (page: Page, action: string, args: unknown[] = []) =>
  page.evaluate(({ action, args }) => {
    const root = document.querySelector('#app') as Element & {
      __vue_app__: { config: { globalProperties: { $pinia: { _s: Map<string, Record<string, unknown>> } } } }
    }
    const store = root.__vue_app__.config.globalProperties.$pinia._s.get('editor')!
    return (store[action] as (...args: unknown[]) => unknown)(...args)
  }, { action, args })

test.describe('split view input recovery', () => {
  let app: ElectronApplication
  let page: Page
  let ids: string[]
  let filePath: string

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown(alpha, { suppressErrorDialog: true })
    ;({ app, page, filePath } = launched)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, beta)
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    ids = await page.locator('.tabs-container > li').evaluateAll(tabs => tabs.map(tab => tab.getAttribute('data-id')!))
    await runStore(page, 'START_SPLIT_VIEW', [{ tabId: ids[0], otherTabId: ids[1], direction: 'vertical' }])
    await expect(page.locator('.editor-pane').nth(1)).toContainText('Beta text')
  })

  test.afterEach(async() => {
    if (app) {
      try { await expectNoRendererErrors(app) } finally { await app.close() }
    }
  })

  test('typing and list edits stay independent while repeatedly switching panes', async() => {
    const panes = page.locator('.editor-pane')
    for (let round = 0; round < 5; round++) {
      for (const pane of [0, 1]) {
        await panes.nth(pane).locator('.mu-paragraph-content').last().click()
        await page.keyboard.press('End')
        await page.keyboard.type(` pane${pane}round${round}`)
        await page.keyboard.press('Enter')
        await page.keyboard.type('- [ ] New task')
        await page.keyboard.press('Enter')
        await page.keyboard.type('Next task')
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.keyboard.type('Continue typing')
      }
    }
    await expect(panes.nth(0)).toContainText('pane0round4')
    await expect(panes.nth(0)).not.toContainText('pane1round')
    await expect(panes.nth(1)).toContainText('pane1round4')
    await expect(panes.nth(1)).not.toContainText('pane0round')
  })

  test('an invalid deferred edit recovers without losing text or reopening the error', async() => {
    await page.evaluate(() => {
      const root = document.querySelector('[data-pane="0"] .mu-container') as Element & {
        __MUYA_BLOCK__: {
          muya: {
            editor: {
              scrollPage: { lastContentInDescendant(): { text: string; update(): void } }
              jsonState: { removeOperation(path: number[]): void }
            }
            flush(): void
          }
        }
      }
      const muya = root.__MUYA_BLOCK__.muya
      const leaf = muya.editor.scrollPage.lastContentInDescendant()
      leaf.text = 'Alpha text recovered'
      leaf.update()
      muya.editor.jsonState.removeOperation([99])
      muya.flush()
    })
    const left = page.locator('.editor-pane').nth(0)
    await left.locator('.mu-paragraph-content').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type('+continuedTyping', { delay: 20 })
    await expect(left).toContainText('Alpha text recovered+continuedTyping')
    await expect(page.locator('.editor-pane').nth(1)).toContainText('Beta text')
    await runStore(page, 'FILE_SAVE')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('Alpha text recovered+continuedTyping')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(left).toContainText('Alpha text recovered')
    await expect(left).not.toContainText('+continuedTyping')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(left).toContainText('Alpha text')
    await expect(left).not.toContainText('recovered')
  })

  test('a selection crossing panes cannot delete either document', async() => {
    await page.locator('.editor-pane').nth(0).locator('.mu-paragraph-content').last().click()
    await page.evaluate(() => {
      const left = document.querySelector('[data-pane="0"] .mu-paragraph-content')!
      const right = document.querySelector('[data-pane="1"] .mu-paragraph-content')!
      const anchor = document.createTreeWalker(left, NodeFilter.SHOW_TEXT).nextNode()!
      const focus = document.createTreeWalker(right, NodeFilter.SHOW_TEXT).nextNode()!
      document.getSelection()!.setBaseAndExtent(anchor, 1, focus, 4)
    })
    await page.keyboard.press('Backspace')
    await expect(page.locator('.editor-pane').nth(0)).toContainText('First task')
    await expect(page.locator('.editor-pane').nth(0)).toContainText('Alpha text')
    await expect(page.locator('.editor-pane').nth(1)).toContainText('Beta text')
    await page.locator('.editor-pane').nth(1).locator('.mu-paragraph-content').last().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' still editable')
    await expect(page.locator('.editor-pane').nth(1)).toContainText('Beta text still editable')
  })
})
