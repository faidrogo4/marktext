import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  Object.assign(window, {
    path: { sep: '/', dirname: (p: string) => p.slice(0, p.lastIndexOf('/')) },
    electron: {
      clipboard: { writeText: () => {} },
      ipcRenderer: { send: () => {}, on: () => {} }
    }
  })
})
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))
vi.mock('@/contextMenu/popupMenu', () => ({ popupContextMenu: vi.fn() }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn()
}))

import bus from '@/bus'
import { createEditorPaneBus } from '@/bus/editorPane'
import { useEditorStore } from '@/store/editor'
import { createDocumentState } from '@/store/help'
import { showContextMenu } from '@/contextMenu/tabs'
import { popupContextMenu } from '@/contextMenu/popupMenu'

describe('split view document lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    bus.all.clear()
  })

  const setup = () => {
    const store = useEditorStore()
    store.tabs = ['alpha', 'beta', 'gamma'].map((name) =>
      createDocumentState({
        filename: `${name}.md`,
        pathname: `/docs/${name}.md`,
        markdown: name
      })
    )
    store.currentFile = store.tabs[0]!
    const [a, b, c] = store.tabs
    store.START_SPLIT_VIEW({ tabId: a!.id, otherTabId: b!.id, direction: 'vertical' })
    return { store, a: a!, b: b!, c: c! }
  }

  it('keeps two different files visible as focus changes', () => {
    const { store, a, b } = setup()
    store.UPDATE_CURRENT_FILE(b)
    expect(store.activePane).toBe(1)
    expect(store.getPaneFile(0)?.id).toBe(a.id)
    expect(store.getPaneFile(1)?.id).toBe(b.id)
    store.UPDATE_CURRENT_FILE(a)
    expect(store.activePane).toBe(0)
  })

  it('opens a third tab in the active pane', () => {
    const { store, a, b, c } = setup()
    store.UPDATE_CURRENT_FILE(b)
    store.UPDATE_CURRENT_FILE(c)
    expect(store.splitView?.fileIds).toEqual([a.id, c.id])
    expect(store.currentFile?.id).toBe(c.id)
  })

  it.each(['vertical', 'horizontal'] as const)(
    'supports %s and refuses duplicate or missing files',
    (direction) => {
      const { store, a, b } = setup()
      store.START_SPLIT_VIEW({ tabId: a.id, otherTabId: b.id, direction })
      expect(store.splitView?.direction).toBe(direction)
      store.START_SPLIT_VIEW({ tabId: a.id, otherTabId: a.id, direction })
      store.START_SPLIT_VIEW({ tabId: a.id, otherTabId: 'missing', direction })
      expect(store.splitView?.fileIds).toEqual([a.id, b.id])
    }
  )

  it('collapses without closing files and keeps the chosen file', () => {
    const { store, b } = setup()
    store.CLOSE_SPLIT_VIEW(b.id)
    expect(store.splitView).toBeNull()
    expect(store.currentFile?.id).toBe(b.id)
    expect(store.tabs).toHaveLength(3)
    expect(store.getPaneFile(0)?.id).toBe(b.id)
    expect(store.getPaneFile(1)).toBeNull()
  })

  it.each([0, 1])('closing pane %i keeps the other file in a single pane', (pane) => {
    const { store, a, b } = setup()
    store.UPDATE_CURRENT_FILE(b)
    store.FORCE_CLOSE_TAB(pane === 0 ? a : b)
    expect(store.splitView).toBeNull()
    expect(store.currentFile?.id).toBe(pane === 0 ? b.id : a.id)
    expect(store.tabs).toHaveLength(2)
  })

  it('closing an unrelated tab preserves the split', () => {
    const { store, c } = setup()
    store.FORCE_CLOSE_TAB(c)
    expect(store.splitView).not.toBeNull()
  })

  it('collapses after confirmed bulk closure', () => {
    const { store, a, b } = setup()
    store.CLOSE_TABS([a.id])
    expect(store.splitView).toBeNull()
    expect(store.currentFile?.id).toBe(b.id)
  })

  it('offers both directions and routes the chosen open file from the tab menu', () => {
    const { store, a, b } = setup()
    store.CLOSE_SPLIT_VIEW()
    showContextMenu({ clientX: 10, clientY: 20 }, a)
    const items = vi.mocked(popupContextMenu).mock.calls.at(-1)?.[0]
    const split = items?.find(item => item?.id === 'splitView')
    expect(split?.submenu?.map(item => item.label)).toEqual([
      'Vertical (Side by Side)', 'Horizontal (Top and Bottom)'
    ])
    split?.submenu?.[1]?.submenu?.[0]?.click?.()
    expect(store.splitView).toEqual({ direction: 'horizontal', fileIds: [a.id, b.id] })
    showContextMenu({ clientX: 10, clientY: 20 }, b)
    const close = vi.mocked(popupContextMenu).mock.calls.at(-1)?.[0]?.find(item => item?.id === 'closeSplitView')
    close?.click?.()
    expect(store.splitView).toBeNull()
    expect(store.currentFile?.id).toBe(b.id)
  })
})

describe('pane event routing', () => {
  beforeEach(() => bus.all.clear())

  it('routes window commands to the active pane and disk reloads to their file', () => {
    let active = 'a'
    const paneA = createEditorPaneBus(
      () => 'a',
      () => active === 'a'
    )
    const paneB = createEditorPaneBus(
      () => 'b',
      () => active === 'b'
    )
    const a = vi.fn()
    const b = vi.fn()
    paneA.on('undo', a)
    paneB.on('undo', b)
    paneA.on('file-changed', a)
    paneB.on('file-changed', b)
    bus.emit('undo')
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
    active = 'b'
    bus.emit('undo')
    expect(b).toHaveBeenCalledTimes(1)
    bus.emit('file-changed', { id: 'a', isReload: true })
    expect(a).toHaveBeenCalledTimes(2)
    expect(b).toHaveBeenCalledTimes(1)
    paneA.off('undo', a)
    active = 'a'
    bus.emit('undo')
    expect(a).toHaveBeenCalledTimes(2)
  })

  it('flushes both panes and removes the wrapped listener on unmount', () => {
    const pane = createEditorPaneBus(
      () => 'b',
      () => false
    )
    const flush = vi.fn()
    pane.on('flush-editors', flush)
    bus.emit('flush-editors')
    expect(flush).toHaveBeenCalledOnce()
    pane.off('flush-editors', flush)
    bus.emit('flush-editors')
    expect(flush).toHaveBeenCalledOnce()
  })
})
