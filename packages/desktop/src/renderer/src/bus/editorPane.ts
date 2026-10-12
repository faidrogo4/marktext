import bus from './index'

type Handler = (payload: unknown) => void

const sharedEvents = new Set([
  'flush-editors',
  'language-changed',
  'invalidate-image-cache',
  'print-service-clearup',
  'show-command-palette'
])

// Document updates carry an id; window commands belong to the focused pane.
export const createEditorPaneBus = (
  getFileId: () => string | undefined,
  isActive: () => boolean
) => {
  const listeners = new Map<string, Map<Handler, Handler>>()
  return {
    emit: bus.emit,
    on(event: string, handler: Handler) {
      const wrapped: Handler = (payload) => {
        if (event === 'file-loaded' || event === 'file-changed') {
          const id = (payload as { id?: string } | undefined)?.id
          if (id !== getFileId()) return
        } else if (!sharedEvents.has(event) && !isActive()) {
          return
        }
        handler(payload)
      }
      let handlers = listeners.get(event)
      if (!handlers) listeners.set(event, (handlers = new Map()))
      handlers.set(handler, wrapped)
      bus.on(event, wrapped)
    },
    off(event: string, handler: Handler) {
      const handlers = listeners.get(event)
      const wrapped = handlers?.get(handler)
      if (wrapped) bus.off(event, wrapped)
      handlers?.delete(handler)
    }
  }
}
