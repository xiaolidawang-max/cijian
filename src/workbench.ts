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
