import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, BookOpen, ChevronRight, ImageOff, Search } from 'lucide-react'
import './home.css'

type Chapter = { id: string; name: string; count: number; imageUrl: string; savedPosition: number }
type HomeProps = {
  title: string
  onHome: () => void
  hasStarted: boolean
  chapter: string
  chapterNumber: number
  chapterTotal: number
  chapterPosition: number
  word: string
  illustration: ReactNode
  totalWords: number
  chapters: Chapter[]
  notice?: string
  onStudy: () => void
  onDirectory: () => void
  onFavorites: () => void
  onChapter: (id: string) => void
}

function ChapterImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  return <span className="home-chapter-image">{src && !failed ? <img src={src} alt="" loading="lazy" onError={() => setFailed(true)}/> : <BookOpen size={22}/>}</span>
}

export default function Home({ title, onHome, hasStarted, chapter, chapterNumber, chapterTotal, chapterPosition, word, illustration, totalWords, chapters, notice, onStudy, onDirectory, onFavorites, onChapter }: HomeProps) {
  const browsingPosition = hasStarted ? chapterPosition : 0
  const progress = chapterTotal ? Math.min(100, browsingPosition / chapterTotal * 100) : 0
  const main = useRef<HTMLElement>(null)
  const chapterList = useRef<HTMLDivElement>(null)
  const currentChapter = useRef<HTMLButtonElement>(null)

  useLayoutEffect(() => {
    const list = chapterList.current
    const current = currentChapter.current
    if (!list || !current) return
    const listBox = list.getBoundingClientRect()
    const currentBox = current.getBoundingClientRect()
    if (currentBox.top < listBox.top || currentBox.bottom > listBox.bottom) {
      list.scrollTop += currentBox.top - listBox.top - (list.clientHeight - current.clientHeight) / 2
    }
  }, [chapterNumber, chapters.length, hasStarted])

  const focusHome = () => main.current?.focus({ preventScroll: true })

  return <div className="home-page">
    <button className="home-skip" onClick={focusHome}>跳到学习内容</button>
    <header className="home-header">
      <div className="home-header-inner">
        <button className="home-brand" onClick={onHome} aria-label="词间主页">词间</button>
        <button className="home-search" onClick={onDirectory} aria-label="搜索单词、中文释义"><Search size={17}/><span>搜索单词、中文释义</span></button>
        <nav className="home-nav" aria-label="主页导航">
          <button onClick={onHome}>首页</button>
          <button aria-current="page" onClick={onStudy}>学习</button>
          <button onClick={onFavorites}>收藏</button>
        </nav>
      </div>
    </header>

    <main className="home-main" id="home-content" ref={main} tabIndex={-1}>
      <div className="home-heading">
        <div className="home-heading-title"><h1>{title}</h1><button onClick={onHome}><ArrowLeft size={15}/>全部词书</button></div>
        <p>{chapters.length} 个章节 · {totalWords.toLocaleString('en-US')} 个词</p>
      </div>
      {notice && <p className="home-notice" role="status">{notice}</p>}

      <div className="home-layout">
        <section className="home-library" aria-labelledby="home-library-title">
          <div className="home-library-heading">
            <h2 id="home-library-title">章节目录</h2>
            <button className="home-all-words" onClick={onDirectory}>查看全部词汇</button>
          </div>
          <div className="home-chapters" ref={chapterList} tabIndex={0} role="region" aria-label="章节目录，可上下滚动">
            {chapters.map((item, index) => {
              const current = hasStarted && index + 1 === chapterNumber
              return <button className={'home-chapter' + (current ? ' is-current' : '')} key={item.id} ref={current ? currentChapter : undefined} onClick={() => onChapter(item.id)} aria-current={current ? 'true' : undefined} aria-label={`第 ${index + 1} 章 ${item.name}，${item.count} 个词，${item.savedPosition ? '从第 ' + item.savedPosition + ' 个词继续' : '从本章第一个词开始'}`} disabled={!item.count}>
                <span className="home-chapter-number">{String(index + 1).padStart(2, '0')}</span>
                <ChapterImage key={item.imageUrl} src={item.imageUrl}/>
                <span className="home-chapter-copy"><strong>{item.name}</strong>{current && <span className="home-chapter-state">学习中</span>}</span>
                <span className="home-chapter-count">{item.count} 词</span>
                <ChevronRight className="home-chapter-arrow" size={17}/>
              </button>
            })}
          </div>
          <p className="home-chapter-total">共 {chapters.length} 个章节</p>
        </section>

        <aside className="home-overview" aria-label="继续学习">
          <section className="home-continue" aria-labelledby="home-continue-title">
            <h2 id="home-continue-title">{hasStarted ? '继续学习' : '开始学习'}</h2>
            <div className="home-postcard-art" aria-hidden="true">{illustration || <ImageOff size={32}/>}</div>
            <div className="home-continue-copy">
              <div className="home-current-chapter"><h3>{chapter}</h3><span>第 {String(chapterNumber).padStart(2, '0')} 章</span></div>
              <p className="home-current-word">{hasStarted ? '当前单词' : '第一个词'} <strong>{word}</strong></p>
            </div>
            <div className="home-progress">
              <div className="home-progress-track" role="progressbar" aria-label="本章浏览位置" aria-valuemin={0} aria-valuemax={chapterTotal} aria-valuenow={browsingPosition}><span style={{ width: progress + '%' }}/></div>
              <p>本章浏览位置 <span>{browsingPosition} / {chapterTotal}</span></p>
            </div>
            <button className="home-primary" onClick={onStudy}>{hasStarted ? '继续学习' : '开始学习'} <ChevronRight size={18}/></button>
          </section>
        </aside>
      </div>
      <footer className="home-footer">学习位置与记录自动保存在当前浏览器</footer>
    </main>
  </div>
}
