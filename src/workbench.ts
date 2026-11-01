import type { WordCard } from './data'

export interface CourseWord extends WordCard {
  imageUrl: string
  audioUrl: string
  imageName: string
  audioName: string
  reviewed: boolean
  archived: boolean
}
export interface Course {
  title: string
  description: string
  chapters: { id: string; name: string; en: string }[]
  words: CourseWord[]
}
export interface Workbench {
  revision: number
  draft: Course
  published: Course
  savedAt: string | null
  publishedAt: string | null
  missingFiles: string[]
}
export interface Backup {
  id: string
  createdAt: string
  reason: string
  wordCount: number
}
export const cloneCourse = (course: Course): Course => structuredClone(course)
export const wordChanged = (word: CourseWord, published: Course) =>
  JSON.stringify(word) !== JSON.stringify(published.words.find(item => item.id === word.id))
export function missingItems(word: CourseWord, missingFiles: string[] = []) {
  return [
    !word.word.trim() && '英文',
    !word.ipa.trim() && '音标',
    !word.meaningZh.trim() && '释义',
    !word.definitionEn?.trim() && '英文解释',
    !word.exampleEn.trim() && '例句',
    (!word.imageUrl || missingFiles.includes(word.imageUrl)) && '图片',
    (!word.audioUrl || missingFiles.includes(word.audioUrl)) && '音频',
  ].filter(Boolean) as string[]
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const value = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(value.error || '连接失败，请检查工作台服务后重试。')
  return value as T
}
export function postJson(value: unknown, method = 'POST'): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }
}
