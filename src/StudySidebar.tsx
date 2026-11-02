import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Star } from 'lucide-react'
import type { CourseWord } from './workbench'
import './studySidebar.css'

type StudySidebarProps = {
  chapters: { id:string; name:string }[]
  words: CourseWord[]
  selectedId: string
  favorites: string[]
  onSelect: (id:string) => void
}

export default function StudySidebar({ chapters, words, selectedId, favorites, onSelect }: StudySidebarProps) {
  const selectedWord = words.find(word => word.id === selectedId)
  const [expandedChapter, setExpandedChapter] = useState<string | null>(selectedWord?.chapter || chapters[0]?.id || null)
  const chapterWords = useMemo(() => {
    const groups = new Map<string, CourseWord[]>()
    for (const word of words) {
      const group = groups.get(word.chapter)
      if (group) group.push(word)
      else groups.set(word.chapter, [word])
    }
    return groups
  }, [words])
  const favoriteIds = useMemo(() => new Set(favorites), [favorites])
  const list = useRef<HTMLDivElement>(null)
  const activeWord = useRef<HTMLButtonElement>(null)
  const chapterButtons = useRef(new Map<string, HTMLButtonElement>())
  const toggledChapter = useRef<string | null>(null)

  useEffect(() => {
    if (selectedWord) setExpandedChapter(selectedWord.chapter)
  }, [selectedId, selectedWord?.chapter])

  useLayoutEffect(() => {
    const container = list.current
    if (!container) return
    const bounds = container.getBoundingClientRect()
    // Keep a clicked chapter visible when the previous long list collapses.
    if (toggledChapter.current) {
      const button = chapterButtons.current.get(toggledChapter.current)
      toggledChapter.current = null
      if (button) {
        const row = button.getBoundingClientRect()
        if (row.top < bounds.top || row.bottom > bounds.bottom) container.scrollTop += row.top - bounds.top
      }
      return
    }
    const active = activeWord.current
    if (!active || expandedChapter !== selectedWord?.chapter) return
    const headerHeight = chapterButtons.current.get(expandedChapter)?.offsetHeight || 42
    const row = active.getBoundingClientRect()
    if (row.top < bounds.top + headerHeight + 4 || row.bottom > bounds.bottom - 4) {
      container.scrollTop += row.top + row.height / 2 - bounds.top - (container.clientHeight + headerHeight) / 2
    }
  }, [selectedId, selectedWord?.chapter, expandedChapter, chapterWords])

  const toggleChapter = (id:string) => {
    toggledChapter.current = id
    setExpandedChapter(current => current === id ? null : id)
  }

  return <aside className="study-sidebar" aria-label="章节与单词导航">
    <header className="study-sidebar-header">
      <h2>雅思词汇真经</h2><span>{chapters.length} 章</span>
    </header>
    <div className="study-sidebar-list" ref={list} role="navigation" aria-label="章节目录">
      {chapters.map((chapter, chapterIndex) => {
        const entries = chapterWords.get(chapter.id) || []
        const expanded = chapter.id === expandedChapter
        const current = chapter.id === selectedWord?.chapter
        const panelId = 'study-words-' + chapter.id
        return <section className={'study-sidebar-section' + (current ? ' is-current' : '')} key={chapter.id}>
          <h3 className="study-sidebar-section-heading"><button
            className="study-sidebar-section-toggle"
            ref={element => { if (element) chapterButtons.current.set(chapter.id, element); else chapterButtons.current.delete(chapter.id) }}
            aria-expanded={expanded}
            aria-controls={panelId}
            aria-label={(expanded ? '收起' : '展开') + '第 ' + (chapterIndex + 1) + ' 章 ' + chapter.name}
            onClick={() => toggleChapter(chapter.id)}
          >
            <ChevronRight className="study-sidebar-section-chevron" size={14} aria-hidden="true"/>
            <span className="study-sidebar-section-number">{String(chapterIndex + 1).padStart(2, '0')}</span>
            <span className="study-sidebar-section-name">{chapter.name}</span>
            <span className="study-sidebar-section-count">{entries.length}</span>
          </button></h3>
          <div className="study-sidebar-section-words" id={panelId} hidden={!expanded}>
            {expanded && entries.map((word, index) => {
              const selected = word.id === selectedId
              return <button key={word.id} ref={selected ? activeWord : undefined} className={'study-sidebar-word' + (selected ? ' is-selected' : '')} aria-current={selected ? 'page' : undefined} aria-label={'学习单词 ' + word.word} onClick={() => onSelect(word.id)}>
                <span className="study-sidebar-word-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className="study-sidebar-word-label" lang="en">{word.word}</span>
                <span className="study-sidebar-word-star">{favoriteIds.has(word.id) && <Star size={12} fill="currentColor" aria-label="已收藏"/>}</span>
              </button>
            })}
            {expanded && !entries.length && <p className="study-sidebar-empty">本章暂无词条</p>}
          </div>
        </section>
      })}
    </div>
  </aside>
}
