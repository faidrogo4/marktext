import {
  SEPARATOR,
  getCloseThis,
  getCloseOthers,
  getCloseSaved,
  getCloseAll,
  getRENAME,
  getCopyPath,
  getShowInFolder
} from './menuItems'
import { popupContextMenu } from '../popupMenu'
import { useEditorStore } from '@/store/editor'
import { t } from '@/i18n'

type MenuItemShape = {
  type?: string
  click?: (...args: unknown[]) => void
  enabled?: boolean
  [key: string]: unknown
}

const wrapClick = (item: MenuItemShape, tabId: string): MenuItemShape => {
  if (!item || item.type === 'separator') return item
  const click = item.click
  return {
    ...item,
    click: click ? () => click({ _tabId: tabId }, null) : undefined
  }
}

interface ContextMenuClickEvent {
  clientX: number
  clientY: number
}

interface TabLike {
  id: string
  pathname?: string | null
}

export const showContextMenu = (event: ContextMenuClickEvent, tab: TabLike): void => {
  const editorStore = useEditorStore()
  const otherTabs = editorStore.tabs.filter((file) => file.id !== tab.id)
  const splitView = {
    id: 'splitView',
    label: t('contextMenu.tabs.splitView'),
    enabled: otherTabs.length > 0,
    submenu: (['vertical', 'horizontal'] as const).map((direction) => ({
      id: `splitView-${direction}`,
      label: t(`contextMenu.tabs.split${direction === 'vertical' ? 'Vertical' : 'Horizontal'}`),
      submenu: otherTabs.map((file) => ({
        label: file.pathname || file.filename,
        click: () => editorStore.START_SPLIT_VIEW({ tabId: tab.id, otherTabId: file.id, direction })
      }))
    }))
  }
  const closeSplitView = {
    id: 'closeSplitView',
    label: t('contextMenu.tabs.closeSplitView'),
    click: () => editorStore.CLOSE_SPLIT_VIEW(tab.id)
  }
  const { pathname } = tab
  const closeThis = getCloseThis()
  const closeOthers = getCloseOthers()
  const closeSaved = getCloseSaved()
  const closeAll = getCloseAll()
  const rename = getRENAME()
  const copyPath = getCopyPath()
  const showInFolder = getShowInFolder()

  ;([rename, copyPath, showInFolder] as MenuItemShape[]).forEach((item) => {
    item.enabled = !!pathname
  })

  const items = [
    splitView,
    ...(editorStore.splitView ? [closeSplitView] : []),
    SEPARATOR,
    closeThis,
    closeOthers,
    closeSaved,
    closeAll,
    SEPARATOR,
    rename,
    copyPath,
    showInFolder
  ].map((item) => wrapClick(item as MenuItemShape, tab.id))

  popupContextMenu(items, { x: event.clientX, y: event.clientY })
}
