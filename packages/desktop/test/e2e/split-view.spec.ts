import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync } from 'node:fs'
import {
  enterSourceMode,
  exitSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer,
  waitForMenuReady
} from './helpers'

const runStore = (page: Page, action: string, args: unknown[] = []) =>
  page.evaluate(
    ({ action, args }) => {
      const root = document.querySelector('#app') as Element & {
        __vue_app__: {
          config: { globalProperties: { $pinia: { _s: Map<string, Record<string, unknown>> } } }
        }
      }
      const store = root.__vue_app__.config.globalProperties.$pinia._s.get('editor')!
      return (store[action] as (...args: unknown[]) => unknown)(...args)
    },
    { action, args }
  )

const fileIds = (page: Page) =>
  page
    .locator('.tabs-container > li')
    .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute('data-id')!))

test.describe('split view', () => {
  let app: ElectronApplication
  let page: Page
  let ids: string[]
  let alphaPath: string

  test.beforeEach(async() => {
    const launched = await launchWithMarkdown('alpha text\n', { suppressErrorDialog: true })
    app = launched.app
    page = launched.page
    alphaPath = launched.filePath
    await waitForMenuReady(app)
    await sendIpcToRenderer(app, 'mt::new-untitled-tab', true, 'beta text\n')
    await expect(page.locator('.tabs-container > li')).toHaveCount(2)
    ids = await fileIds(page)
  })

  test.afterEach(async() => {
    if (app) {
      await expectNoRendererErrors(app)
      await app.close()
    }
  })

  for (const direction of ['vertical', 'horizontal'] as const) {
    test(`${direction} panes retain independent content and collapse without closing files`, async() => {
      await runStore(page, 'START_SPLIT_VIEW', [{ tabId: ids[0], otherTabId: ids[1], direction }])
      const panes = page.locator('.editor-pane')
      await expect(panes).toHaveCount(2)
      await expect(panes.nth(0).locator('.editor-component')).toContainText('alpha text')
      await expect(panes.nth(1).locator('.editor-component')).toContainText('beta text')
      const left = await panes.nth(0).boundingBox()
      const right = await panes.nth(1).boundingBox()
      expect(left).not.toBeNull()
      expect(right).not.toBeNull()
      if (direction === 'vertical') {
        expect(right!.x).toBeGreaterThan(left!.x + left!.width)
        expect(right!.y).toBe(left!.y)
      } else {
        expect(right!.y).toBeGreaterThan(left!.y + left!.height)
        expect(right!.x).toBe(left!.x)
      }
      await enterSourceMode(page, app)
      await panes.nth(1).locator('.source-code .CodeMirror').click()
      await page.evaluate(() => {
        const el = document.querySelector('[data-pane="1"] .CodeMirror') as Element & {
          CodeMirror: { replaceRange(text: string, pos: { line: number; ch: number }): void }
        }
        el.CodeMirror.replaceRange(' changed', { line: 0, ch: 9 })
      })
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await expect
        .poll(() =>
          page.evaluate(() => {
            const el = document.querySelector('[data-pane="1"] .CodeMirror') as Element & {
              CodeMirror: { getValue(): string }
            }
            return el.CodeMirror.getValue().trim()
          })
        )
        .toBe('beta text')
      await exitSourceMode(page, app)
      await expect(panes.nth(0).locator('.editor-component')).toContainText('alpha text')
      await expect(panes.nth(1).locator('.editor-component')).toContainText('beta text')
      await runStore(page, 'CLOSE_SPLIT_VIEW', [ids[1]])
      await expect(panes).toHaveCount(1)
      await expect(page.locator('.tabs-container > li')).toHaveCount(2)
      await expect(panes.locator('.editor-component')).toContainText('beta text')
    })
  }

  test('the divider resizes with the keyboard and closing either displayed tab restores one pane', async() => {
    await runStore(page, 'START_SPLIT_VIEW', [
      { tabId: ids[0], otherTabId: ids[1], direction: 'vertical' }
    ])
    const divider = page.getByRole('separator')
    await divider.focus()
    await divider.press('ArrowRight')
    await expect(divider).toHaveAttribute('aria-valuenow', '55')
    await runStore(page, 'CLOSE_TABS', [[ids[0]]])
    await expect(page.locator('.editor-pane')).toHaveCount(1)
    await expect(page.locator('.editor-component')).toContainText('beta text')
    await expect(page.locator('.tabs-container > li')).toHaveCount(1)
  })

  test('rendered editing, undo, and saving affect only the active file', async() => {
    await runStore(page, 'START_SPLIT_VIEW', [{ tabId: ids[0], otherTabId: ids[1], direction: 'vertical' }])
    const panes = page.locator('.editor-pane')
    await panes.nth(0).locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' left end', { delay: 20 })
    await expect(panes.nth(0).locator('.editor-component')).toContainText('alpha text left end')
    await expect(panes.nth(1).locator('.editor-component')).toContainText('beta text')
    await panes.nth(1).locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.keyboard.type(' right end', { delay: 20 })
    await expect(panes.nth(1).locator('.editor-component')).toContainText('beta text right end')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(panes.nth(1).locator('.editor-component')).toContainText('beta text')
    await expect(panes.nth(1).locator('.editor-component')).not.toContainText('right end')
    await expect(panes.nth(0).locator('.editor-component')).toContainText('alpha text left end')
    await panes.nth(0).locator('.mu-paragraph-content').first().click()
    await runStore(page, 'FILE_SAVE')
    await expect.poll(() => readFileSync(alphaPath, 'utf8').trim()).toBe('alpha text left end')
  })
})
