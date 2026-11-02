import { REVIEW_KEY, validReviewRecords } from './studyReview.ts'
import type { ReviewRecords } from './studyReview.ts'
import { CHAPTER_POSITION_PREFIX, FAVORITES_KEY, OPTIONS_KEY, POSITION_KEY, REVIEW_SESSION_KEY, createStudyId, notifyStudyChanges, validChapterPositions, validReviewSession, validStudyOptions, withStudyLock, writeStudyEntries } from './studyStorage.ts'
import type { ChapterPositions, ExclusiveRunner, ReviewSession, StudyOptions } from './studyStorage.ts'
export { FAVORITES_KEY, OPTIONS_KEY, POSITION_KEY } from './studyStorage.ts'
export type { StudyOptions } from './studyStorage.ts'

export interface StudyBackup {
  format: 'wordspace-study-backup'
  version: 1 | 2 | 3
  exportedAt: string
  position: string
  favorites: string[]
  options: StudyOptions
  reviews?: ReviewRecords
  chapterPositions?: ChapterPositions
  reviewSession?: ReviewSession | null
}

export function parseStudyBackup(text: string): StudyBackup {
  if (text.length > 2_000_000) throw new Error('备份文件过大。')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('文件不是有效的 JSON 备份。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份格式不正确。')
  const item = value as Record<string, unknown>
  if (item.format !== 'wordspace-study-backup' || (item.version !== 1 && item.version !== 2 && item.version !== 3)) throw new Error('不支持这个备份格式或版本。')
  if (typeof item.exportedAt !== 'string' || !Number.isFinite(Date.parse(item.exportedAt))) throw new Error('备份时间无效。')
  if (typeof item.position !== 'string' || !item.position || item.position.length > 256) throw new Error('学习位置无效。')
  if (!Array.isArray(item.favorites) || item.favorites.length > 100_000 || item.favorites.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('收藏记录无效。')
  if (!validStudyOptions(item.options)) throw new Error('学习设置无效。')
  if (item.version >= 2 && !validReviewRecords(item.reviews)) throw new Error('复习记录无效。')
  if (item.version === 3 && (!validChapterPositions(item.chapterPositions) || (item.reviewSession !== null && !validReviewSession(item.reviewSession)))) throw new Error('章节进度或未完成练习无效。')
  const options = item.options
  return {
    format:'wordspace-study-backup', version:item.version, exportedAt:item.exportedAt, position:item.position,
    favorites:[...new Set(item.favorites as string[])],
    options:{ chinese:options.chinese, auto:options.auto, largeText:options.largeText, speed:options.speed, ...(options.imageSize !== undefined ? { imageSize:options.imageSize } : {}) },
    ...(item.version >= 2 ? { reviews:item.reviews as ReviewRecords } : {}),
    ...(item.version === 3 ? { chapterPositions:item.chapterPositions as ChapterPositions, reviewSession:item.reviewSession as ReviewSession | null } : {}),
  }
}

// Share the grading/favorites lock so a second tab cannot write a stale collection
// over a restored backup. Old backups discard newer bookmarks/sessions that are
// absent from that snapshot; v1 still leaves its unsupported review records alone.
export async function restoreStudyBackup(storage: Storage, backup: StudyBackup, exclusive: ExclusiveRunner = withStudyLock) {
  const value = parseStudyBackup(JSON.stringify(backup))
  return exclusive(() => {
    const changes = new Map<string, string | null>([[POSITION_KEY, value.position], [FAVORITES_KEY, JSON.stringify(value.favorites)], [OPTIONS_KEY, JSON.stringify(value.options)]])
    if (value.reviews !== undefined) changes.set(REVIEW_KEY, JSON.stringify(value.reviews))
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (key?.startsWith(CHAPTER_POSITION_PREFIX)) changes.set(key, null)
    }
    for (const [chapter, word] of Object.entries(value.chapterPositions || {})) changes.set(CHAPTER_POSITION_PREFIX + encodeURIComponent(chapter), word)
    // Rotate identity to invalidate stale grading actions in other open tabs.
    const session = value.reviewSession ? { ...value.reviewSession, id:createStudyId(), updatedAt:Date.now() } : null
    changes.set(REVIEW_SESSION_KEY, session ? JSON.stringify(session) : null)
    writeStudyEntries(storage, [...changes])
    notifyStudyChanges()
    return session
  })
}
