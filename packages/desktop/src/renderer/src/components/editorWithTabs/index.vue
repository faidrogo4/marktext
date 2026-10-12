<template>
  <div
    class="editor-with-tabs"
    :style="{ 'max-width': `calc(100vw - ${effectiveSideBarWidth}px)` }"
  >
    <tabs v-show="showTabBar" />
    <div
      ref="workspace"
      class="editor-workspace"
      :class="splitView?.direction"
    >
      <template
        v-for="pane of paneIndexes"
        :key="pane"
      >
        <div
          class="editor-pane"
          :class="{ 'pane-active': editorStore.activePane === pane }"
          :data-pane="pane"
          :data-file-id="editorStore.getPaneFile(pane)?.id"
          :style="splitView ? { flex: `${pane === 0 ? ratio : 100 - ratio} 1 0` } : undefined"
          @pointerdown.capture="activatePane(pane)"
          @focusin="activatePane(pane)"
        >
          <div
            v-if="splitView"
            class="pane-header"
          >
            <select
              :value="editorStore.getPaneFile(pane)?.id"
              :aria-label="t('contextMenu.tabs.selectSplitFile')"
              @change="selectFile($event, pane)"
            >
              <option
                v-for="file of openTabs"
                :key="file.id"
                :value="file.id"
                :disabled="file.id === splitView.fileIds[1 - pane]"
                :title="file.pathname"
              >
                {{ file.filename }}{{ file.isSaved ? '' : ' •' }}
              </option>
            </select>
            <button
              type="button"
              :title="t('contextMenu.tabs.closeSplitView')"
              :aria-label="t('contextMenu.tabs.closeSplitView')"
              @click="editorStore.CLOSE_SPLIT_VIEW(editorStore.getPaneFile(pane)?.id)"
            >
              ×
            </button>
          </div>
          <div class="container">
            <editor
              :pane="pane"
              :markdown="editorStore.getPaneFile(pane)?.markdown ?? markdown"
              :cursor="editorStore.getPaneFile(pane)?.cursor ?? cursor"
              :text-direction="textDirection"
              :platform="platform"
            />
            <source-code
              v-if="sourceCode"
              :pane="pane"
              :markdown="editorStore.getPaneFile(pane)?.markdown ?? markdown"
              :muya-index-cursor="editorStore.getPaneFile(pane)?.muyaIndexCursor ?? muyaIndexCursor"
              :text-direction="textDirection"
            />
          </div>
        </div>
        <div
          v-if="splitView && pane === 0"
          class="split-divider"
          role="separator"
          tabindex="0"
          :aria-label="t('contextMenu.tabs.resizeSplitView')"
          :aria-orientation="splitView.direction"
          :aria-valuenow="Math.round(ratio)"
          :aria-valuemin="20"
          :aria-valuemax="80"
          @pointerdown.prevent="startResize"
          @keydown="resizeWithKeyboard"
          @dblclick="ratio = 50"
        />
      </template>
    </div>
    <tab-notifications />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useLayoutStore } from '@/store/layout'
import { useEditorStore } from '@/store/editor'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import Tabs from './tabs.vue'
import Editor from './editor.vue'
import SourceCode from './sourceCode.vue'
import TabNotifications from './notifications.vue'

defineProps<{
  markdown: string
  cursor: unknown
  muyaIndexCursor?: unknown
  sourceCode: boolean
  showTabBar: boolean
  textDirection: string
  platform: string
}>()

const { t } = useI18n()
const editorStore = useEditorStore()
const { tabs: openTabs, splitView } = storeToRefs(editorStore)
const { effectiveSideBarWidth } = storeToRefs(useLayoutStore())
const paneIndexes = computed(() => (splitView.value ? [0, 1] : [0]))
const workspace = ref<HTMLDivElement | null>(null)
const ratio = ref(50)

const activatePane = (pane: number) => {
  const file = editorStore.getPaneFile(pane)
  if (file) editorStore.UPDATE_CURRENT_FILE(file)
}

const selectFile = (event: Event, pane: number) => {
  activatePane(pane)
  const id = (event.target as HTMLSelectElement).value
  const file = openTabs.value.find((tab) => tab.id === id)
  if (file) editorStore.UPDATE_CURRENT_FILE(file)
}

const clampRatio = (value: number) => Math.max(20, Math.min(80, value))
const resize = (event: PointerEvent) => {
  const rect = workspace.value?.getBoundingClientRect()
  if (!rect || !splitView.value) return
  const vertical = splitView.value.direction === 'vertical'
  const length = vertical ? rect.width : rect.height
  if (!length) return
  ratio.value = clampRatio(
    (100 * (vertical ? event.clientX - rect.left : event.clientY - rect.top)) / length
  )
}
const stopResize = () => {
  window.removeEventListener('pointermove', resize)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('pointercancel', stopResize)
}
const startResize = () => {
  window.addEventListener('pointermove', resize)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('pointercancel', stopResize)
}
const resizeWithKeyboard = (event: KeyboardEvent) => {
  const keys =
    splitView.value?.direction === 'vertical'
      ? ['ArrowLeft', 'ArrowRight']
      : ['ArrowUp', 'ArrowDown']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  ratio.value = clampRatio(ratio.value + (event.key === keys[0] ? -5 : 5))
}

watch(
  () => splitView.value?.direction,
  () => {
    stopResize()
    ratio.value = 50
  }
)
onBeforeUnmount(stopResize)
</script>

<style scoped>
.editor-with-tabs {
  position: relative;
  height: 100%;
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--editorBgColor);
}
.editor-workspace {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.editor-workspace.horizontal {
  flex-direction: column;
}
.editor-pane {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.container {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.pane-header {
  display: flex;
  flex: 0 0 28px;
  align-items: center;
  border-bottom: 2px solid transparent;
  background: var(--itemBgColor);
}
.pane-active .pane-header {
  border-bottom-color: var(--themeColor);
}
.pane-header select {
  flex: 1;
  min-width: 0;
  margin: 0 6px;
  border: 0;
  color: var(--editorColor);
  background: var(--editorBgColor);
  font: inherit;
  font-size: 12px;
}
.pane-header button {
  border: 0;
  padding: 0 8px;
  color: var(--editorColor);
  background: transparent;
  cursor: pointer;
  font-size: 18px;
}
.split-divider {
  flex: 0 0 5px;
  background: var(--itemBgColor);
  cursor: col-resize;
  touch-action: none;
}
.horizontal > .split-divider {
  cursor: row-resize;
}
.split-divider:hover,
.split-divider:focus-visible {
  background: var(--themeColor);
}
</style>
