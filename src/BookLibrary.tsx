import { useRef, useState } from 'react'
import { ArrowRight, Search, Settings, X } from 'lucide-react'
import './bookLibrary.css'

type BookLibraryProps = {
  title: string
  chapterCount: number
  wordCount: number
  hasStarted: boolean
  chapter: string
  chapterPosition: number
  chapterTotal: number
  notice?: string
  onOpenBook: () => void
  onStudy: () => void
  onFavorites: () => void
  onSettings: () => void
}

function BookCover({ title, small = false }: { title: string; small?: boolean }) {
  return <span className={'books-cover' + (small ? ' is-small' : '')} aria-hidden="true">
    <strong>IELTS</strong>
    <span>{title}</span>
    <span className="books-cover-lines"><i/><i/><i/></span>
  </span>
}

export default function BookLibrary({ title, chapterCount, wordCount, hasStarted, chapter, chapterPosition, chapterTotal, notice, onOpenBook, onStudy, onFavorites, onSettings }: BookLibraryProps) {
  const [query, setQuery] = useState('')
  const main = useRef<HTMLElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const term = query.normalize('NFKC').trim().toLocaleLowerCase()
  const matches = !term || (title + ' 雅思 IELTS').normalize('NFKC').toLocaleLowerCase().includes(term)
  const focusHome = () => main.current?.focus({ preventScroll: true })
  const clearSearch = () => { setQuery(''); search.current?.focus() }

  return <div className="books-page">
    <button className="books-skip" onClick={focusHome}>跳到词书列表</button>
    <header className="books-header">
      <button className="books-brand" onClick={focusHome} aria-label="词间首页">词间</button>
      <nav className="books-nav" aria-label="网站导航">
        <button aria-current="page" onClick={focusHome}>首页</button>
        <button onClick={hasStarted ? onStudy : onOpenBook}>学习</button>
        <button onClick={onFavorites}>收藏</button>
      </nav>
      <button className="books-settings" onClick={onSettings} aria-label="学习设置" title="学习设置"><Settings size={21}/></button>
    </header>

    <main className="books-main" ref={main} tabIndex={-1}>
      <div className="books-heading">
        <div><h1>选择词书</h1><p>{hasStarted ? '选一本词书，从上次的位置继续。' : '选一本词书，开始学习。'}</p></div>
        <div className="books-search">
          <Search size={19} aria-hidden="true"/>
          <input ref={search} type="search" aria-label="搜索词书" placeholder="搜索词书" value={query} onChange={event => setQuery(event.target.value)}/>
          {query && <button onClick={clearSearch} aria-label="清除词书搜索"><X size={16}/></button>}
        </div>
      </div>
      {notice && <p className="books-notice" role="status">{notice}</p>}

      <section className="books-resume" aria-label={hasStarted ? '继续上次学习' : '开始学习'}>
        <BookCover title={title} small/>
        <div className="books-resume-title"><span>{hasStarted ? '上次学习' : '开始学习'}</span><h2>{title}</h2></div>
        <p className="books-resume-position">{hasStarted ? <>{chapter}<span>·</span><span>{chapterPosition} / {chapterTotal} 词</span></> : '先选择章节，按自己的节奏开始。'}</p>
        <button className="books-primary" onClick={hasStarted ? onStudy : onOpenBook}>{hasStarted ? '继续学习' : '选择章节'}<ArrowRight size={19}/></button>
      </section>

      <div className="books-list-heading"><h2>全部词书</h2><span aria-live="polite">{matches ? 1 : 0} 本词书</span></div>
      <section className="books-grid" aria-label="词书列表">
        {matches ? <button className={'books-card' + (hasStarted ? ' is-started' : '')} onClick={onOpenBook} aria-label={'查看' + title + '的章节'}>
          <BookCover title={title}/>
          <span className="books-card-copy">
            <strong className="books-card-title">{title}</strong>
            <span className="books-card-meta">{chapterCount} 章 · {wordCount.toLocaleString('en-US')} 词</span>
            {hasStarted && <span className="books-card-state">学习中</span>}
            <span className="books-card-action">查看章节<ArrowRight size={17}/></span>
          </span>
        </button> : <div className="books-empty" role="status"><Search size={25}/><h2>没有找到词书</h2><p>试试“雅思”或“IELTS”。</p><button onClick={clearSearch}>清除搜索</button></div>}
      </section>
      <footer className="books-footer">学习位置自动保存在当前浏览器</footer>
    </main>
  </div>
}
