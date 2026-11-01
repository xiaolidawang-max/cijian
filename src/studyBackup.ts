export const POSITION_KEY = 'wordspace.current-word.v3'
export const FAVORITES_KEY = 'wordspace.favorites.v1'
export const OPTIONS_KEY = 'wordspace.study-options.v1'

export interface StudyOptions { chinese: boolean; auto: boolean; speed: number; largeText: boolean }
export interface StudyBackup {
  format: 'wordspace-study-backup'
  version: 1 | 2
  exportedAt: string
  position: string
  favorites: string[]
  options: StudyOptions
  reviews?: ReviewRecords
}

export function parseStudyBackup(text: string): StudyBackup {
  if (text.length > 2_000_000) throw new Error('备份文件过大。')
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new Error('文件不是有效的 JSON 备份。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份格式不正确。')
  const item = value as Record<string, unknown>
  if (item.format !== 'wordspace-study-backup' || (item.version !== 1 && item.version !== 2)) throw new Error('不支持这个备份格式或版本。')
  if (typeof item.exportedAt !== 'string' || !Number.isFinite(Date.parse(item.exportedAt))) throw new Error('备份时间无效。')
  if (typeof item.position !== 'string' || !item.position || item.position.length > 256) throw new Error('学习位置无效。')
  if (!Array.isArray(item.favorites) || item.favorites.length > 100_000 || item.favorites.some(id => typeof id !== 'string' || !id || id.length > 256)) throw new Error('收藏记录无效。')
  const options = item.options as Record<string, unknown> | null
  if (!options || typeof options !== 'object' || Array.isArray(options) || typeof options.chinese !== 'boolean' || typeof options.auto !== 'boolean' || typeof options.largeText !== 'boolean' || (options.speed !== 1 && options.speed !== 0.8)) throw new Error('学习设置无效。')
  if (item.version === 2 && !validReviewRecords(item.reviews)) throw new Error('复习记录无效。')
  return { format:'wordspace-study-backup', version:item.version, exportedAt:item.exportedAt, position:item.position, favorites:[...new Set(item.favorites as string[])], options:{ chinese:options.chinese, auto:options.auto, largeText:options.largeText, speed:options.speed }, ...(item.version === 2 ? { reviews:item.reviews as ReviewRecords } : {}) }
}

// Restore all three existing keys together; leave the previous values in place on failure.
export function restoreStudyBackup(storage: Storage, backup: StudyBackup) {
  const entries: [string, string][] = [[POSITION_KEY, backup.position], [FAVORITES_KEY, JSON.stringify(backup.favorites)], [OPTIONS_KEY, JSON.stringify(backup.options)]]
  if (backup.reviews !== undefined) entries.push([REVIEW_KEY, JSON.stringify(backup.reviews)])
  const previous = entries.map(([key]) => storage.getItem(key))
  try { entries.forEach(([key, value]) => storage.setItem(key, value)) }
  catch (error) {
    entries.forEach(([key], index) => { try { const value = previous[index]; if (value === null) storage.removeItem(key); else storage.setItem(key, value) } catch { /* Storage may be unavailable. */ } })
    throw error
  }
}
import { REVIEW_KEY, validReviewRecords } from './studyReview.ts'
import type { ReviewRecords } from './studyReview.ts'
