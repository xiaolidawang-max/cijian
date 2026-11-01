export const REVIEW_KEY = 'wordspace.review.v1'
export type ReviewRecord = { stage:number; dueAt:number; reviewedAt:number }
export type ReviewRecords = Record<string, ReviewRecord>
const DAY = 86_400_000
const INTERVALS = [DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY]

export function normalizeSpelling(value: string) {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').replace(/[’‘]/g, "'").toLocaleLowerCase('en')
}

export function validReviewRecords(value: unknown): value is ReviewRecords {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entries = Object.entries(value)
  return entries.length <= 100_000 && entries.every(([id, item]) => {
    if (!id || id.length > 256 || !item || typeof item !== 'object' || Array.isArray(item)) return false
    const record = item as Record<string, unknown>
    return Number.isInteger(record.stage) && (record.stage as number) >= 0 && (record.stage as number) <= INTERVALS.length && typeof record.dueAt === 'number' && Number.isFinite(record.dueAt) && record.dueAt >= 0 && record.dueAt <= 8.64e15 && typeof record.reviewedAt === 'number' && Number.isFinite(record.reviewedAt) && record.reviewedAt >= 0 && record.reviewedAt <= 8.64e15
  })
}
export function readReviewRecords(): ReviewRecords {
  try { const value: unknown = JSON.parse(localStorage.getItem(REVIEW_KEY) || '{}'); return validReviewRecords(value) ? value : {} } catch { return {} }
}
export function scheduleReview(previous: ReviewRecord | undefined, remembered: boolean, now: number): ReviewRecord {
  if (!remembered) return { stage:0, reviewedAt:now, dueAt:now + 10 * 60_000 }
  const stage = Math.min((previous?.stage || 0) + 1, INTERVALS.length)
  return { stage, reviewedAt:now, dueAt:now + INTERVALS[stage - 1] }
}
export function makeReviewQueue<T extends { id:string; meaningZh:string }>(words: T[], records: ReviewRecords, now: number, limit = 20, filter: 'mixed' | 'due' | 'new' = 'mixed'): T[] {
  const eligible = words.filter(word => {
    if (!word.meaningZh.trim()) return false
    const record = records[word.id]
    return record ? filter !== 'new' && record.dueAt <= now : filter !== 'due'
  })
  return eligible.sort((a, b) => {
    const aDue = records[a.id]?.dueAt
    const bDue = records[b.id]?.dueAt
    if (aDue === undefined) return bDue === undefined ? 0 : 1
    return bDue === undefined ? -1 : aDue - bDue
  }).slice(0, limit)
}
