import { REVIEW_KEY, scheduleReview, validReviewRecords } from './studyReview.ts'
import type { ReviewRecords } from './studyReview.ts'

export const POSITION_KEY = 'wordspace.current-word.v3'
export const FAVORITES_KEY = 'wordspace.favorites.v1'
export const OPTIONS_KEY = 'wordspace.study-options.v1'
export const CHAPTER_POSITION_PREFIX = 'wordspace.chapter-position.v1.'
export const REVIEW_SESSION_KEY = 'wordspace.review-session.v1'
export const STUDY_LOCK = 'wordspace.study.v1'
const CHANGE_EVENT = 'wordspace-study-change'

export interface StudyOptions { chinese: boolean; auto: boolean; speed: number; largeText: boolean; imageSize?: 240 | 300 | 360 }
export type ChapterPositions = Record<string, string>
export interface ReviewSession {
  version: 1
  id: string
  queue: string[]
  step: number
  mode: 'recall' | 'spelling'
  scope: 'chapter' | 'all' | 'favorites'
  filter: 'mixed' | 'due' | 'new'
  chapterId?: string
  updatedAt: number
}
export type NewReviewSession = Pick<ReviewSession, 'queue' | 'mode' | 'scope' | 'filter' | 'chapterId'>
export type ExclusiveRunner = <T>(operation: () => T | Promise<T>) => Promise<T>

export class StudyConflictError extends Error {
  constructor(message = '这轮练习已在另一个窗口更新，请继续最新进度。') { super(message); this.name = 'StudyConflictError' }
}

const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256
const validFavorites = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 100_000 && value.every(validId)
export function validStudyOptions(value: unknown): value is StudyOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const options = value as Record<string, unknown>
  return typeof options.chinese === 'boolean' && typeof options.auto === 'boolean' && typeof options.largeText === 'boolean' && (options.speed === 1 || options.speed === 0.8) && (options.imageSize === undefined || options.imageSize === 240 || options.imageSize === 300 || options.imageSize === 360)
}
export function validChapterPositions(value: unknown): value is ChapterPositions {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length <= 10_000 && Object.entries(value).every(([chapter, word]) => validId(chapter) && validId(word))
}
export function validReviewSession(value: unknown): value is ReviewSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const item = value as Record<string, unknown>
  return item.version === 1 && validId(item.id) && Array.isArray(item.queue) && item.queue.length > 0 && item.queue.length <= 2_000 && item.queue.every(validId) && new Set(item.queue).size === item.queue.length && Number.isInteger(item.step) && (item.step as number) >= 0 && (item.step as number) <= item.queue.length && (item.mode === 'recall' || item.mode === 'spelling') && (item.scope === 'chapter' || item.scope === 'all' || item.scope === 'favorites') && (item.filter === 'mixed' || item.filter === 'due' || item.filter === 'new') && (item.chapterId === undefined || validId(item.chapterId)) && typeof item.updatedAt === 'number' && Number.isFinite(item.updatedAt) && item.updatedAt >= 0 && item.updatedAt <= 8.64e15
}

function readValidated<T>(storage: Storage, key: string, fallback: T, validate: (value: unknown) => value is T): T {
  const raw = storage.getItem(key)
  if (raw === null) return fallback
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('已有学习记录格式异常，原记录未被覆盖。请从有效备份恢复。') }
  if (!validate(value)) throw new Error('已有学习记录格式异常，原记录未被覆盖。请从有效备份恢复。')
  return value
}

// Getters are safe for rendering. Mutations below use strict reads so corrupted
// data is never silently replaced by an empty collection.
export function readFavorites(storage?: Storage): string[] {
  try { return [...new Set(readValidated(storage ?? localStorage, FAVORITES_KEY, [], validFavorites))] } catch { return [] }
}
export function readChapterPositions(storage?: Storage): ChapterPositions {
  const positions: ChapterPositions = Object.create(null)
  try {
    const target = storage ?? localStorage
    for (let index = 0; index < target.length; index++) {
      const key = target.key(index)
      if (!key?.startsWith(CHAPTER_POSITION_PREFIX)) continue
      let chapter: string
      try { chapter = decodeURIComponent(key.slice(CHAPTER_POSITION_PREFIX.length)) } catch { continue }
      const word = target.getItem(key)
      if (validId(chapter) && validId(word)) positions[chapter] = word
    }
  } catch { /* The caller can still display the current card without storage. */ }
  return positions
}
export function readReviewSession(storage?: Storage): ReviewSession | null {
  try { return readValidated(storage ?? localStorage, REVIEW_SESSION_KEY, null as ReviewSession | null, (value): value is ReviewSession | null => value === null || validReviewSession(value)) } catch { return null }
}
export function readStoredReviews(storage?: Storage): ReviewRecords {
  try { return readValidated(storage ?? localStorage, REVIEW_KEY, {}, validReviewRecords) } catch { return {} }
}
export function readStudyOptions(storage?: Storage): StudyOptions {
  const defaults: StudyOptions = { chinese:true, auto:false, speed:1, largeText:false }
  try { return readValidated(storage ?? localStorage, OPTIONS_KEY, defaults, validStudyOptions) } catch { return defaults }
}

// The shared lock protects all read-modify-write operations across tabs, including
// backup restoration. Refuse unsafe writes on older/insecure browser contexts.
export const withStudyLock: ExclusiveRunner = async operation => {
  if (typeof navigator === 'undefined' || !navigator.locks?.request) throw new Error('当前浏览器不支持安全保存，请使用新版 Edge 或 Chrome 从本地快捷方式打开。')
  return navigator.locks.request(STUDY_LOCK, { mode:'exclusive' }, operation)
}

export function notifyStudyChanges() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CHANGE_EVENT))
}
export function subscribeStudyChanges(listener: () => void): () => void {
  const storageChanged = (event: StorageEvent) => { if (event.key === null || event.key.startsWith('wordspace.')) listener() }
  window.addEventListener('storage', storageChanged)
  window.addEventListener(CHANGE_EVENT, listener)
  return () => { window.removeEventListener('storage', storageChanged); window.removeEventListener(CHANGE_EVENT, listener) }
}

// Synchronous writes inside the lock are committed together from the app's point
// of view. If one write fails, roll back previous values before releasing it.
export function writeStudyEntries(storage: Storage, entries: [string, string | null][]) {
  const previous = entries.map(([key]) => storage.getItem(key))
  try {
    for (const [key, value] of entries) { if (value === null) storage.removeItem(key); else storage.setItem(key, value) }
  } catch (error) {
    let rollbackFailed = false
    entries.forEach(([key], index) => {
      try { const value = previous[index]; if (value === null) storage.removeItem(key); else storage.setItem(key, value) } catch { rollbackFailed = true }
    })
    if (rollbackFailed) throw new Error('浏览器存储不可用，记录未能完整保存。请保留当前页面并检查存储空间。')
    throw error
  }
}

export function createStudyStore(storage: Storage, exclusive: ExclusiveRunner = withStudyLock, notify: () => void = notifyStudyChanges) {
  const mutate = <T>(operation: () => T) => exclusive(() => { const result = operation(); notify(); return result })
  const strictSession = () => readValidated(storage, REVIEW_SESSION_KEY, null as ReviewSession | null, (value): value is ReviewSession | null => value === null || validReviewSession(value))
  return {
    toggleFavorite: (id: string) => mutate(() => {
      if (!validId(id)) throw new Error('词条无效。')
      const latest = [...new Set(readValidated(storage, FAVORITES_KEY, [], validFavorites))]
      const updated = latest.includes(id) ? latest.filter(word => word !== id) : [...latest, id]
      storage.setItem(FAVORITES_KEY, JSON.stringify(updated))
      return updated
    }),
    savePosition: (chapterId: string, wordId: string, previous?: { chapterId:string; wordId:string }) => mutate(() => {
      if (!validId(chapterId) || !validId(wordId)) throw new Error('章节或词条无效。')
      const entries: [string, string | null][] = [[POSITION_KEY, wordId], [CHAPTER_POSITION_PREFIX + encodeURIComponent(chapterId), wordId]]
      if (previous && previous.chapterId !== chapterId && validId(previous.chapterId) && validId(previous.wordId)) {
        const previousKey = CHAPTER_POSITION_PREFIX + encodeURIComponent(previous.chapterId)
        if (storage.getItem(previousKey) === null) entries.push([previousKey, previous.wordId])
      }
      writeStudyEntries(storage, entries)
      return readChapterPositions(storage)
    }),
    updateOptions: (patch: Partial<StudyOptions>) => mutate(() => {
      const latest = readValidated(storage, OPTIONS_KEY, { chinese:true, auto:false, speed:1, largeText:false }, validStudyOptions)
      const updated = { ...latest, ...patch }
      if (!validStudyOptions(updated)) throw new Error('学习设置无效。')
      storage.setItem(OPTIONS_KEY, JSON.stringify(updated))
      return updated
    }),
    createReviewSession: (input: NewReviewSession, expectedId: string | null = null) => mutate(() => {
      const current = strictSession()
      if ((current?.id || null) !== expectedId) throw new StudyConflictError()
      const session: ReviewSession = { ...input, version:1, id:crypto.randomUUID(), queue:[...input.queue], step:0, updatedAt:Date.now() }
      if (!validReviewSession(session)) throw new Error('本轮练习内容无效，请重新选择词条。')
      storage.setItem(REVIEW_SESSION_KEY, JSON.stringify(session))
      return session
    }),
    saveReview: (id: string, remembered: boolean, now: number, expected?: { id:string; step:number }) => mutate(() => {
      if (!validId(id) || !Number.isFinite(now) || now < 0 || now > 8.64e15 - 30 * 86_400_000) throw new Error('复习记录无效。')
      const currentSession = strictSession()
      if (expected && (!currentSession || currentSession.id !== expected.id || currentSession.step !== expected.step || currentSession.queue[currentSession.step] !== id)) throw new StudyConflictError()
      const latest = readValidated(storage, REVIEW_KEY, {}, validReviewRecords)
      const reviews: ReviewRecords = { ...latest, [id]:scheduleReview(latest[id], remembered, now) }
      const session = expected && currentSession ? { ...currentSession, step:currentSession.step + 1, updatedAt:now } : currentSession
      const entries: [string, string | null][] = [[REVIEW_KEY, JSON.stringify(reviews)]]
      if (expected) entries.push([REVIEW_SESSION_KEY, JSON.stringify(session)])
      writeStudyEntries(storage, entries)
      return { reviews, session }
    }),
    clearReviewSession: (expectedId: string) => mutate(() => {
      const current = strictSession()
      if (!current) return
      if (current.id !== expectedId) throw new StudyConflictError()
      storage.removeItem(REVIEW_SESSION_KEY)
    }),
  }
}

const browserStore = () => createStudyStore(localStorage)
export const toggleFavorite = async (id: string) => browserStore().toggleFavorite(id)
export const savePosition = async (chapterId: string, wordId: string, previous?: { chapterId:string; wordId:string }) => browserStore().savePosition(chapterId, wordId, previous)
export const updateOptions = async (patch: Partial<StudyOptions>) => browserStore().updateOptions(patch)
export const createReviewSession = async (input: NewReviewSession, expectedId: string | null = null) => browserStore().createReviewSession(input, expectedId)
export const saveReview = async (id: string, remembered: boolean, now: number, session?: { id:string; step:number }) => browserStore().saveReview(id, remembered, now, session)
export const clearReviewSession = async (expectedId: string) => browserStore().clearReviewSession(expectedId)
