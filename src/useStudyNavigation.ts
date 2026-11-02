import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export type StudyPage = 'library' | 'chapters' | 'study'
export type StudyDialogName = 'find' | 'keys' | 'settings' | 'image' | 'end' | 'chapters'
type View = { page: StudyPage; dialog: StudyDialogName | null }
type Entry = View & { id: string; parentId: string | null }
type PendingClose = { parentId: string; next: View }

const dialogs = new Set<StudyDialogName>(['find', 'keys', 'settings', 'image', 'end', 'chapters'])
const home: View = { page: 'library', dialog: null }

function readEntry(state: unknown): Entry {
  const value = state && typeof state === 'object' && 'cijianPage' in state ? state.cijianPage : null
  const entry = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const base = entry.basePage === 'chapters' || entry.basePage === 'study' ? entry.basePage : entry.home === false ? 'study' : 'library'
  // Keep compatibility with page entries made before the review view was removed.
  const page = entry.page === 'study' || entry.page === 'chapters' ? entry.page : entry.page === 'review' ? base : 'library'
  const parentId = typeof entry.dialogParent === 'string' ? entry.dialogParent : null
  const dialog = parentId && typeof entry.dialog === 'string' && dialogs.has(entry.dialog as StudyDialogName) ? entry.dialog as StudyDialogName : null
  return { page, dialog, parentId, id: typeof entry.entryId === 'string' ? entry.entryId : '' }
}

function writeEntry(entry: Entry, replace = false) {
  const state = {
    ...window.history.state,
    cijianPage: {
      page: entry.page,
      basePage: entry.page,
      entryId: entry.id,
      ...(entry.dialog ? { dialog: entry.dialog, dialogParent: entry.parentId } : {}),
    },
  }
  if (replace) window.history.replaceState(state, '')
  else window.history.pushState(state, '')
}

/** Mobile sheets get one temporary entry above their page, not a nested stack. */
export function useStudyNavigation(mobile: boolean, onRestore: () => void) {
  const [view, setView] = useState<View>(home)
  const viewRef = useRef(view)
  const mobileRef = useRef(mobile)
  const restoreRef = useRef(onRestore)
  const initialized = useRef(false)
  const pending = useRef<PendingClose | null>(null)
  const sequence = useRef(0)
  const session = useRef('')
  mobileRef.current = mobile
  restoreRef.current = onRestore

  const nextId = useCallback(() => {
    if (!session.current) session.current = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    return session.current + '-' + ++sequence.current
  }, [])

  const apply = useCallback((next: View) => {
    viewRef.current = next
    setView(current => current.page === next.page && current.dialog === next.dialog ? current : next)
  }, [])

  // Called only on a normal page entry, including after a sheet's back completes.
  const commit = useCallback((next: View) => {
    let current = readEntry(window.history.state)
    if (current.page !== next.page) {
      current = { page: next.page, dialog: null, parentId: null, id: nextId() }
      writeEntry(current)
    } else if (!current.id || current.dialog) {
      current = { page: next.page, dialog: null, parentId: null, id: nextId() }
      writeEntry(current, true)
    }
    if (mobileRef.current && next.dialog) {
      writeEntry({ ...next, id: nextId(), parentId: current.id })
    }
    apply(next)
  }, [apply, nextId])

  const transition = useCallback((next: View) => {
    // history.back() is asynchronous. Keep the latest user intent until it lands,
    // so closing then immediately reopening/selecting a word cannot race the pop.
    if (pending.current) {
      pending.current.next = next
      apply(next)
      return
    }
    const current = readEntry(window.history.state)
    if (current.dialog && current.parentId) {
      if (mobileRef.current && next.dialog && next.page === current.page) {
        writeEntry({ ...current, ...next }, true)
        apply(next)
      } else {
        pending.current = { parentId: current.parentId, next }
        apply(next)
        window.history.back()
      }
      return
    }
    commit(next)
  }, [apply, commit])

  const navigate = useCallback((page: StudyPage) => transition({ page, dialog: null }), [transition])
  const setDialog = useCallback((dialog: StudyDialogName | null) => transition({ ...viewRef.current, dialog }), [transition])

  useLayoutEffect(() => {
    // The guard survives StrictMode's setup/cleanup/setup cycle. A real fresh
    // launch still starts at the book library, matching the desktop behaviour.
    if (!initialized.current) {
      initialized.current = true
      writeEntry({ ...home, id: nextId(), parentId: null }, true)
    }
    const restore = (event: PopStateEvent) => {
      const entry = readEntry(event.state)
      const closing = pending.current
      pending.current = null
      if (closing && entry.id === closing.parentId) {
        // Consuming a sheet must not overwrite a word/page selected while closing.
        commit(closing.next)
        return
      }
      // An unexpected destination is a real browser traversal (e.g. a history
      // menu jump); respect it instead of replaying an abandoned UI action.
      restoreRef.current()
      apply({ page: entry.page, dialog: mobileRef.current ? entry.dialog : null })
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [apply, commit, nextId])

  useLayoutEffect(() => {
    const current = readEntry(window.history.state)
    if (pending.current) return
    if (!mobile && current.dialog) {
      // Preserve desktop-capable dialogs while removing their mobile-only entry.
      transition(viewRef.current)
    } else if (mobile && viewRef.current.dialog && !current.dialog) {
      transition(viewRef.current)
    }
  }, [mobile, transition])

  return { ...view, navigate, setDialog }
}
