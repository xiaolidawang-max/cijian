import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, Eye, EyeOff, ImageOff, Keyboard, List, Maximize2, MoreHorizontal, Pause, RotateCcw, Search, Star, Volume2, X } from 'lucide-react'
import { assetUrl, chapters as originalChapters, words as originalWords } from './data'
import type { Course, CourseWord } from './workbench'
import { FAVORITES_KEY, OPTIONS_KEY, POSITION_KEY, parseStudyBackup, restoreStudyBackup } from './studyBackup'
import type { StudyBackup } from './studyBackup'
import { REVIEW_KEY, makeReviewQueue, normalizeSpelling, readReviewRecords, scheduleReview } from './studyReview'
import { loadReferenceDictionary } from './referenceDictionary'
import { buildStudyContent } from './studyContent'
import { publicPath } from './publicPath'
import './study.css'

const seed: Course = {
  title: '雅思词汇真经', description: '图文刷词 · 打开即学', chapters: originalChapters,
  words: originalWords.map(word => ({ ...word, imageUrl: assetUrl(word.chapter === 'plants' ? 'study-images' : 'images', word.image), audioUrl: word.audio ? assetUrl('audio', word.audio) : '', imageName: word.image, audioName: word.audio || '', reviewed: false, archived: false })),
}
function readPosition() {
  try { return localStorage.getItem(POSITION_KEY) || 'photosynthesis' } catch { return 'photosynthesis' }
}
function readFavorites(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [] } catch { return [] }
}
function readOptions() {
  try {
    const value = JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')
    return { chinese: value.chinese !== false, auto: value.auto === true, speed: value.speed === 0.8 ? 0.8 : 1, largeText: value.largeText === true }
  } catch { return { chinese: true, auto: false, speed: 1, largeText: false } }
}
const pad = (value: number) => String(value).padStart(2, '0')
const RESULT_PAGE_SIZE = 60

interface PhotoFrame { url:string; left:number; top:number; width:number; height:number; background:string }
type StudyResources = { atlas:unknown; ecdict:unknown; phrases:unknown; wordnet:unknown; wordnetDefinitions:unknown; wiktionary:unknown; tatoeba:unknown; tatoebaEnglish:unknown; frames:Record<string, PhotoFrame> }
const emptyResources: StudyResources = { atlas:null, ecdict:null, phrases:null, wordnet:null, wordnetDefinitions:null, wiktionary:null, tatoeba:null, tatoebaEnglish:null, frames:{} }
function WordIllustration({ card, retry, failed, frames, sourceUrl, decorative = false }: { card:CourseWord; retry:number; failed:()=>void; frames:Record<string, PhotoFrame>; sourceUrl?:string; decorative?:boolean }) {
  const frame = card.imageFrame
  const rounded = frames[card.id]
  const alt = decorative ? '' : card.imageAlt || card.word + ' 插画'
  if (!frame && rounded?.url === card.imageUrl && rounded.width > 0 && rounded.height > 0) return <span className="st-art-canvas" style={{ background:rounded.background }}><span className="st-art-frame" style={{ left:rounded.left * 100 + '%', top:rounded.top * 100 + '%', width:rounded.width * 100 + '%', height:rounded.height * 100 + '%' }}><img key={card.id + '-' + retry} src={sourceUrl || card.imageUrl} alt={alt} draggable={false} onError={failed} style={{ width:100 / rounded.width + '%', height:100 / rounded.height + '%', left:-100 * rounded.left / rounded.width + '%', top:-100 * rounded.top / rounded.height + '%' }}/></span></span>
  const picture = <img key={card.id + '-' + retry} src={sourceUrl || card.imageUrl} alt={alt} draggable={false} onError={failed} style={frame ? { width:100 / frame.width + '%', height:100 / frame.height + '%', left:-100 * frame.left / frame.width + '%', top:-100 * frame.top / frame.height + '%' } : undefined}/>
  return frame ? <span className="st-image-crop" style={{ width:'min(100%,calc(var(--st-image-height) * ' + frame.aspectRatio + '))', aspectRatio:frame.aspectRatio }}>{picture}</span> : <span className="st-art-canvas st-whole-art">{picture}</span>
}

function StudyDialog({ title, children, close, wide = false, image = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean; image?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className={'st-dialog' + (wide ? ' wide' : '') + (image ? ' st-image-dialog' : '')} aria-labelledby="study-dialog-title" onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="st-dialog-inner"><span className="st-sheet-handle" aria-hidden="true"/><header><h2 id="study-dialog-title">{title}</h2><button className="st-icon" aria-label="关闭窗口" onClick={close}><X size={20}/></button></header>{children}</div>
  </dialog>
}

export default function App() {
  const [course, setCourse] = useState<Course>(seed)
  const [resources, setResources] = useState<StudyResources>(emptyResources)
  const [resourcesLoaded, setResourcesLoaded] = useState(false)
  const [selectedId, setSelectedId] = useState(readPosition)
  const [favorites, setFavorites] = useState(readFavorites)
  const [options, setOptions] = useState(readOptions)
  const [dialog, setDialog] = useState<'find' | 'keys' | 'settings' | 'image' | 'end' | 'review' | null>(null)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [readingBar, setReadingBar] = useState(false)
  const [imageZoom, setImageZoom] = useState(false)
  const [answerOverride, setAnswerOverride] = useState<{ id: string; show: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [searchChapter, setSearchChapter] = useState('all')
  const [resultPage, setResultPage] = useState(0)
  const [online, setOnline] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [storageError, setStorageError] = useState(false)
  const [imageError, setImageError] = useState(false)
  const [imageRetry, setImageRetry] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [pendingBackup, setPendingBackup] = useState<StudyBackup | null>(null)
  const [backupMessage, setBackupMessage] = useState('')
  const [reviews, setReviews] = useState(readReviewRecords)
  const [reviewScope, setReviewScope] = useState('chapter')
  const [reviewMode, setReviewMode] = useState<'recall' | 'spelling'>('recall')
  const [reviewFilter, setReviewFilter] = useState<'mixed' | 'due' | 'new'>('mixed')
  const [spelling, setSpelling] = useState('')
  const [spellingMessage, setSpellingMessage] = useState('')
  const [reviewQueue, setReviewQueue] = useState<string[] | null>(null)
  const [reviewStep, setReviewStep] = useState(0)
  const [reviewRevealed, setReviewRevealed] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewNow, setReviewNow] = useState(Date.now)
  const audio = useRef<HTMLAudioElement | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const main = useRef<HTMLElement | null>(null)
  const heading = useRef<HTMLDivElement | null>(null)
  const results = useRef<HTMLDivElement | null>(null)
  const activeResult = useRef<HTMLButtonElement | null>(null)
  const initialFocus = useRef(false)
  const swipe = useRef<{ x: number; y: number; at: number; id: number } | null>(null)
  const suppressImageTapUntil = useRef(0)
  const backupInput = useRef<HTMLInputElement | null>(null)

  const words = useMemo(() => course.chapters.flatMap(chapter => course.words.filter(word => word.chapter === chapter.id && !word.archived)), [course])
  const index = Math.max(0, words.findIndex(word => word.id === selectedId))
  const card = words[index]
  const study = useMemo(() => card ? buildStudyContent(card, resources.atlas, resources.ecdict, resources.phrases, resources.wordnet, resources.tatoeba, resources.wordnetDefinitions, resources.wiktionary, resources.tatoebaEnglish) : null, [card, resources])
  const chineseVisible = answerOverride?.id === card?.id ? answerOverride?.show : options.chinese
  const chapter = course.chapters.find(item => item.id === card?.chapter) || course.chapters[0]
  const chapterWords = words.filter(word => word.chapter === chapter?.id)
  const chapterIndex = chapterWords.findIndex(word => word.id === card?.id)
  const previous = words[index - 1]
  const next = words[index + 1]
  const starred = favorites.includes(card?.id)
  const position = chapterIndex + 1
  const progress = chapterWords.length ? position / chapterWords.length * 100 : 0
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>()
    for (const word of words) {
      const content = resourcesLoaded ? buildStudyContent(word, resources.atlas, resources.ecdict, resources.phrases, resources.wordnet, resources.tatoeba, resources.wordnetDefinitions, resources.wiktionary, resources.tatoebaEnglish) : null
      const text = [word.word, word.meaningZh, ...word.phrases, ...word.phraseTranslations, ...(content?.senses.map(sense => sense.meaning) || []), ...(content?.phrases.flatMap(phrase => [phrase.en, phrase.zh]) || [])]
      index.set(word.id, text.join('\n').toLocaleLowerCase())
    }
    return index
  }, [words, resources, resourcesLoaded])
  const visibleResults = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return words.filter(word => (!favoritesOnly || favorites.includes(word.id)) && (searchChapter === 'all' || word.chapter === searchChapter) && (!term || searchIndex.get(word.id)?.includes(term)))
  }, [words, query, searchChapter, favoritesOnly, favorites, searchIndex])
  const favoriteCount = words.filter(word => favorites.includes(word.id)).length
  const resultPages = Math.max(1, Math.ceil(visibleResults.length / RESULT_PAGE_SIZE))
  const currentResultPage = Math.min(resultPage, resultPages - 1)
  const pagedResults = visibleResults.slice(currentResultPage * RESULT_PAGE_SIZE, (currentResultPage + 1) * RESULT_PAGE_SIZE)
  const reviewWords = reviewScope === 'chapter' ? chapterWords : reviewScope === 'favorites' ? words.filter(word => favorites.includes(word.id)) : words
  const availableReview = makeReviewQueue(reviewWords, reviews, reviewNow, 20, reviewFilter)
  const reviewedCount = reviewWords.filter(word => !!reviews[word.id]).length
  const dueCount = reviewWords.filter(word => !!reviews[word.id] && reviews[word.id].dueAt <= reviewNow).length
  const newCount = reviewWords.filter(word => !reviews[word.id] && word.meaningZh.trim()).length
  const dayStart = new Date(reviewNow); dayStart.setHours(0, 0, 0, 0)
  const todayCount = reviewWords.filter(word => reviews[word.id]?.reviewedAt >= dayStart.getTime() && reviews[word.id]?.reviewedAt <= reviewNow).length
  const nextDue = reviewWords.reduce<number | null>((earliest, word) => {
    const due = reviews[word.id]?.dueAt
    return due && due > reviewNow && (earliest === null || due < earliest) ? due : earliest
  }, null)
  const reviewCard = reviewQueue ? words.find(word => word.id === reviewQueue[reviewStep]) : undefined

  function persist(key: string, value: string) {
    try { localStorage.setItem(key, value); setStorageError(false) } catch { setStorageError(true) }
  }
  function changeOptions(value: Partial<typeof options>) {
    const updated = { ...options, ...value }
    setOptions(updated)
    if ('chinese' in value) setAnswerOverride(null)
    persist(OPTIONS_KEY, JSON.stringify(updated))
  }
  const stopAudio = useCallback(() => {
    const player = audio.current
    if (player) { player.pause(); player.onended = null; player.onerror = null; audio.current = null }
    setPlaying(false)
  }, [])
  const playAudioUrl = useCallback((url: string) => {
    if (!url) return
    stopAudio()
    setAudioError('')
    const player = new Audio(url)
    player.playbackRate = optionsRef.current.speed
    audio.current = player
    setPlaying(true)
    player.onended = () => { if (audio.current === player) { audio.current = null; setPlaying(false) } }
    const fail = () => {
      if (audio.current !== player) return
      audio.current = null
      setPlaying(false)
      setAudioError('读音未能播放，请点击播放按钮重试。')
    }
    player.onerror = fail
    void player.play().catch(fail)
  }, [stopAudio])
  const playAudio = useCallback(() => { if (card?.audioUrl) playAudioUrl(card.audioUrl) }, [card?.audioUrl, playAudioUrl])

  const goTo = useCallback((id: string) => {
    if (!words.some(word => word.id === id)) return
    initialFocus.current = true
    stopAudio()
    setSelectedId(id)
    setAnswerOverride(null)
    setDialog(null)
    setReadingBar(false)
    try { localStorage.setItem(POSITION_KEY, id); setStorageError(false) } catch { setStorageError(true) }
    main.current?.scrollTo({ top: 0, behavior: 'instant' })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [words, stopAudio])
  const openFinder = useCallback((scope = chapter?.id || 'all', collection = false) => {
    setQuery('')
    setSearchChapter(scope)
    setFavoritesOnly(collection)
    const matches = words.filter(word => (scope === 'all' || word.chapter === scope) && (!collection || favorites.includes(word.id)))
    setResultPage(Math.floor(Math.max(0, matches.findIndex(word => word.id === card?.id)) / RESULT_PAGE_SIZE))
    setDialog('find')
  }, [chapter?.id, words, favorites, card?.id])
  function toggleFavorite() {
    if (!card) return
    const updated = starred ? favorites.filter(id => id !== card.id) : [...favorites, card.id]
    setFavorites(updated)
    persist(FAVORITES_KEY, JSON.stringify(updated))
  }

  function exportProgress() {
    const backup: StudyBackup = { format:'wordspace-study-backup', version:2, exportedAt:new Date().toISOString(), position:card.id, favorites, options, reviews }
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type:'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = '词间学习记录-' + new Date().toISOString().slice(0, 10) + '.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setBackupMessage('已开始下载学习记录。请妥善保存备份文件。')
  }
  async function chooseBackup(file: File | undefined) {
    setPendingBackup(null)
    setBackupMessage('')
    if (!file) return
    try {
      if (file.size > 2_000_000) throw new Error('备份文件过大。')
      const backup = parseStudyBackup(await file.text())
      if (!words.some(word => word.id === backup.position)) throw new Error('备份中的学习位置不在当前课程中，暂不能恢复。')
      setPendingBackup(backup)
    } catch (error) { setBackupMessage(error instanceof Error ? error.message : '无法读取备份文件。') }
    if (backupInput.current) backupInput.current.value = ''
  }
  function confirmBackup() {
    if (!pendingBackup) return
    try {
      restoreStudyBackup(localStorage, pendingBackup)
      stopAudio()
      setSelectedId(pendingBackup.position)
      setFavorites(pendingBackup.favorites)
      setOptions(pendingBackup.options)
      if (pendingBackup.reviews) setReviews(pendingBackup.reviews)
      setAnswerOverride(null)
      setStorageError(false)
      setPendingBackup(null)
      setBackupMessage('学习记录已恢复。')
    } catch { setBackupMessage('无法写入浏览器存储，请检查存储权限后重试。') }
  }
  function beginReview() {
    const queue = makeReviewQueue(reviewWords, reviews, Date.now(), 20, reviewFilter).map(word => word.id)
    setReviewQueue(queue)
    setReviewStep(0)
    setReviewRevealed(false)
    setReviewError('')
    setAudioError('')
    setSpelling('')
    setSpellingMessage('')
  }
  function openReview() {
    stopAudio()
    setAudioError('')
    setReviewQueue(null)
    setReviewError('')
    setDialog('review')
  }
  function gradeReview(remembered: boolean) {
    if (!reviewCard) return
    const updated = { ...reviews, [reviewCard.id]:scheduleReview(reviews[reviewCard.id], remembered, Date.now()) }
    try { localStorage.setItem(REVIEW_KEY, JSON.stringify(updated)) }
    catch { setReviewError('复习结果未能保存，请检查浏览器存储后重试。'); return }
    setReviews(updated)
    stopAudio()
    setReviewError('')
    setReviewRevealed(false)
    setSpelling('')
    setSpellingMessage('')
    setReviewStep(value => value + 1)
  }
  function checkSpelling() {
    if (!reviewCard || !spelling.trim()) { setSpellingMessage('先输入英文单词。'); return }
    if (normalizeSpelling(spelling) === normalizeSpelling(reviewCard.word)) {
      setSpellingMessage('拼写正确。')
      setReviewRevealed(true)
    } else setSpellingMessage('拼写还不对，可以再试一次，或查看答案。')
  }

  useEffect(() => {
    let active = true
    const load = async (name:string) => {
      const response = await fetch(publicPath('/uploads/' + name), { cache:'no-store' })
      if (!response.ok) throw new Error('参考资料暂时不可用。')
      return response.json() as Promise<unknown>
    }
    void Promise.allSettled([
      loadReferenceDictionary(), load('ecdict-reference.json'), load('course-phrases.json'),
      load('wordnet-examples.json'), load('rounded-photo-frames.json'), load('tatoeba-examples.json'), load('wordnet-definitions.json'), load('wiktionary-definitions.json'), load('tatoeba-english-examples.json'),
    ]).then(results => {
      if (!active) return
      const value = (index:number) => results[index].status === 'fulfilled' ? results[index].value : null
      const frameData = value(4) as {version?:number; frames?:Record<string, PhotoFrame>} | null
      const frames = frameData?.version === 1 && frameData.frames ? Object.fromEntries(Object.entries(frameData.frames).map(([id, frame]) => [id, { ...frame, url:publicPath(frame.url) }])) : {}
      setResources({ atlas:value(0), ecdict:value(1), phrases:value(2), wordnet:value(3), tatoeba:value(5), wordnetDefinitions:value(6), wiktionary:value(7), tatoebaEnglish:value(8), frames })
      setResourcesLoaded(true)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 10_000)
    const loadCourse = async () => {
      try {
        const response = await fetch(publicPath('/course.json'), { signal:controller.signal })
        if (!response.ok) throw new Error('课程暂时无法读取。')
        const value: { course:Course } = await response.json()
        if (!value.course || !Array.isArray(value.course.chapters) || !value.course.chapters.length || !Array.isArray(value.course.words)) throw new Error('课程格式无效。')
        value.course.words = value.course.words.map(word => ({ ...word, imageUrl:publicPath(word.imageUrl), imageZoomUrl:word.imageZoomUrl ? publicPath(word.imageZoomUrl) : '', audioUrl:word.audioUrl ? publicPath(word.audioUrl) : '' }))
        if (active) {
          setCourse(value.course)
          setSelectedId(id => value.course.words.some(word => word.id === id && !word.archived) ? id : value.course.words.find(word => !word.archived)?.id || id)
          setOnline(true)
          setLoaded(true)
        }
      } catch { if (active) setOnline(false) }
      finally { window.clearTimeout(timeout) }
    }
    void loadCourse()
    return () => { active = false; controller.abort(); window.clearTimeout(timeout) }
  }, [])

  useEffect(() => {
    if (dialog !== 'review') return
    setReviewNow(Date.now())
    const timer = window.setInterval(() => setReviewNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [dialog])

  useEffect(() => {
    setImageError(false)
    setImageRetry(0)
    setAudioError('')
    // Browsers require an interaction before automatic playback can start.
    if (options.auto && initialFocus.current) playAudio()
    else stopAudio()
    return stopAudio
  }, [card?.id, card?.imageUrl, card?.audioUrl, options.auto, loaded, playAudio, stopAudio])

  useEffect(() => { if (audio.current) audio.current.playbackRate = options.speed }, [options.speed])
  useEffect(() => {
    document.body.classList.add('study-page')
    return () => document.body.classList.remove('study-page')
  }, [])
  useEffect(() => { if (card) document.title = !loaded && online ? '正在加载 · 词间' : dialog === 'review' ? '回忆练习 · 词间' : card.word + ' · 词间' }, [card?.word, dialog, loaded, online])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (dialog || event.altKey || event.repeat) return
      const target = event.target as HTMLElement
      const editing = target.closest('input,textarea,select,[contenteditable="true"]')
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openFinder('all'); return }
      if (editing || event.ctrlKey || event.metaKey) return
      if (event.key === 'ArrowRight' && next) { event.preventDefault(); goTo(next.id) }
      if (event.key === 'ArrowLeft' && previous) { event.preventDefault(); goTo(previous.id) }
      if (target.closest('button,a')) return
      if (event.code === 'Space' && card?.audioUrl) { event.preventDefault(); if (playing) stopAudio(); else playAudio() }
      if (event.key === '/') { event.preventDefault(); openFinder('all') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dialog, previous, next, card?.audioUrl, playing, playAudio, stopAudio, goTo, openFinder])

  useEffect(() => {
    const root = main.current
    const target = heading.current
    if (!root || !target) return
    const observer = new IntersectionObserver(([entry]) => setReadingBar(!entry.isIntersecting && entry.boundingClientRect.bottom < (entry.rootBounds?.top || 0)), { root })
    observer.observe(target)
    return () => observer.disconnect()
  }, [card?.id, loaded, online])
  useEffect(() => {
    if (dialog !== 'find') return
    const frame = requestAnimationFrame(() => {
      const list = results.current
      const active = activeResult.current
      if (!list) return
      if (!query && active) list.scrollTop += active.getBoundingClientRect().top - list.getBoundingClientRect().top - Math.max(36, (list.clientHeight - active.clientHeight) / 2)
      else list.scrollTop = 0
    })
    return () => cancelAnimationFrame(frame)
  }, [dialog, query, searchChapter, favoritesOnly, currentResultPage])

  const renderResult = (word: CourseWord) => <button key={word.id} ref={word.id === card?.id ? activeResult : undefined} aria-current={word.id === card?.id ? 'true' : undefined} className={'st-result' + (word.id === card?.id ? ' selected' : '')} aria-label={'打开单词 ' + word.word} onClick={() => goTo(word.id)}>
    <span><strong>{word.word}</strong>{options.chinese && <small>{word.meaningZh}</small>}</span>{word.id === card?.id && <em>当前</em>}{favorites.includes(word.id) && <Star size={14} className="st-starred"/>}<ChevronRight size={15}/>
  </button>

  if (!loaded && online) return <div className="st-empty-page" role="status"><BookOpen size={32}/><h1>正在加载课程</h1><p>请稍候，正在读取你的词库。</p></div>
  if (!card || !chapter) return <div className="st-empty-page"><BookOpen size={32}/><h1>暂时没有可学习的词条</h1><p>请检查词库文件后刷新页面。</p></div>

  return <div className={'st-shell' + (options.largeText ? ' st-large-text' : '') + (dialog === 'review' ? ' st-review-active' : '')}>
    <a className="st-skip" href="#study-content">跳到当前词卡</a>
    <div className="st-workspace">
      {readingBar && <div className="st-reading-bar"><strong>{card.word}</strong><button className="st-icon" aria-label={chineseVisible ? '隐藏当前词的中文' : '查看当前词的中文'} aria-pressed={chineseVisible} onClick={() => setAnswerOverride({ id: card.id, show: !chineseVisible })}>{chineseVisible ? <EyeOff size={18}/> : <Eye size={18}/>}</button><button className={'st-play' + (playing ? ' playing' : '')} disabled={!card.audioUrl} aria-label={playing ? '停止读音' : '播放 ' + card.word + ' 的读音'} onClick={() => { initialFocus.current = true; if (playing) stopAudio(); else playAudio() }}>{playing ? <Pause size={17}/> : <Volume2 size={18}/>}<span>{playing ? '播放中' : '听读音'}</span></button></div>}
      <main className="st-main" ref={main} id="study-content" tabIndex={-1}>
        <div className="st-content">
          {!online && <p className="st-notice" role="status">词库加载失败，请刷新页面重试。</p>}
          {storageError && <p className="st-notice" role="alert">浏览器未能保存学习记录，本次仍可继续浏览。</p>}
          <div className="st-reading-grid">
            <div className="st-card-column">
              <article className="st-word-card" aria-label={card.word + ' 词卡'} onTouchStart={event => {
                const touch = event.touches[0]
                const target = event.target as HTMLElement
                swipe.current = event.touches.length === 1 && touch.clientX > 24 && (!target.closest('button,a,input,select') || !!target.closest('.st-image-open'))
                  ? { x: touch.clientX, y: touch.clientY, at: Date.now(), id: touch.identifier } : null
              }} onTouchCancel={() => { swipe.current = null }} onTouchEnd={event => {
                const start = swipe.current
                swipe.current = null
                const touch = event.changedTouches[0]
                if (!start || event.touches.length || touch.identifier !== start.id || Date.now() - start.at > 900) return
                const dx = touch.clientX - start.x
                const dy = touch.clientY - start.y
                if (Math.abs(dx) < 65 || Math.abs(dx) < Math.abs(dy) * 1.8) return
                const target = dx < 0 ? next : previous
                if (target) { suppressImageTapUntil.current = Date.now() + 400; goTo(target.id) }
              }}>
                <header className="st-card-tools">
                  <div className="st-card-identity"><span className="st-brand">词间</span><button className="st-chapter-chip" aria-label="打开当前章节目录" onClick={() => openFinder(chapter.id)}><span>{chapter.name}</span><ChevronDown size={13}/></button></div>
                  <div><button className="st-review-entry" aria-label="回忆练习" onClick={openReview}><RotateCcw size={16}/><span>回忆练习</span></button><button className="st-icon st-favorite" aria-label={starred ? '取消收藏单词' : '收藏单词'} aria-pressed={starred} onClick={toggleFavorite}><Star size={19} fill={starred ? 'currentColor' : 'none'}/></button><button className="st-icon st-card-menu" aria-label="学习设置" onClick={() => setDialog('settings')}><MoreHorizontal size={22}/></button></div>
                </header>
                <div className="st-card-position"><span><strong>{pad(position)}</strong> / {pad(chapterWords.length)}</span><div role="progressbar" aria-label="本章浏览位置" aria-valuemin={0} aria-valuemax={chapterWords.length} aria-valuenow={position}><i style={{ width: progress + '%' }}/></div><button className="st-language" aria-label={chineseVisible ? '隐藏当前词的中文' : '查看当前词的中文'} onClick={() => setAnswerOverride({ id: card.id, show: !chineseVisible })}>{chineseVisible ? <EyeOff size={15}/> : <Eye size={15}/>}<span>{chineseVisible ? '隐藏中文' : '显示中文'}</span></button></div>
                <div className="st-illustration">
                  {imageError || !card.imageUrl ? <div className="st-image-fallback" role="status"><ImageOff size={28}/><span>{card.imageUrl ? '插画暂时无法读取' : '这张词卡还没有插画'}</span>{card.imageUrl && <button onClick={() => { setImageError(false); setImageRetry(value => value + 1) }}>重新加载</button>}</div> : <button className="st-image-open" aria-label={'放大 ' + card.word + ' 的插画'} onClick={() => { if (Date.now() < suppressImageTapUntil.current) return; setImageZoom(false); setDialog('image') }}><WordIllustration card={card} retry={imageRetry} frames={resources.frames} failed={() => setImageError(true)}/><span className="st-image-hint"><Maximize2 size={14}/>放大</span></button>}
                </div>
                <div className="st-lexeme" ref={heading} aria-live="polite">
                  <h2>{card.word}</h2>
                  <div className="st-pronunciation"><span>{card.ipa || '音标待补充'}</span><button className={'st-play' + (playing ? ' playing' : '')} aria-label={playing ? '停止读音' : '播放 ' + card.word + ' 的读音'} disabled={!card.audioUrl} onClick={() => { initialFocus.current = true; if (playing) stopAudio(); else playAudio() }}>{playing ? <Pause size={17}/> : <Volume2 size={18}/>}<span>{playing ? '播放中' : card.audioUrl ? '听读音' : '暂无读音'}</span></button></div>
                  {chineseVisible ? <div className="st-meanings" aria-label="中文释义">{study?.senses.length ? study.senses.map((sense, i) => <div className="st-meaning-row" key={i}>{sense.pos && <span className="st-pos">{sense.pos}</span>}<span>{sense.meaning}</span></div>) : <p className="st-meaning">{card.meaningZh || '中文释义待补充'}</p>}</div> : <button className="st-reveal" onClick={() => setAnswerOverride({ id: card.id, show: true })}>查看这个词的中文<ChevronDown size={14}/></button>}
                </div>
                <section className="st-definition" aria-label="单词释义"><span className="st-section-label">词义</span>{study?.definitions.length ? <div className="st-definition-list">{study.definitions.map((definition, i) => <div key={i}>{definition.pos && <span className="st-definition-pos">{definition.pos}</span>}<p lang="en">{definition.en}</p>{chineseVisible && definition.zh && <p className="st-translation">{definition.zh}</p>}</div>)}</div> : <p>{resourcesLoaded ? '暂无英文释义。' : '正在加载词典…'}</p>}</section>
                {audioError && <p className="st-audio-error" role="alert">{audioError}</p>}
              </article>
            </div>

            <aside className="st-context" aria-label="搭配与例句">
              <header><h2>用法与例句</h2></header>
              <section className="st-context-section"><h3><span className="st-section-label">常用搭配</span><span>{study?.phrases.length || 0} 组</span></h3><div className="st-phrases">{study?.phrases.length ? study.phrases.map((phrase, i) => <div key={i}><span className="st-phrase-dot"/><div><p lang="en">{phrase.en}</p>{chineseVisible && phrase.zh && <small>{phrase.zh}</small>}</div></div>) : <p className="st-unavailable">{resourcesLoaded ? '暂无可用搭配。' : '正在加载词典…'}</p>}</div></section>
              <section className="st-context-section"><h3><span className="st-section-label">语境例句</span></h3>{study?.examples.length ? <div className="st-examples">{study.examples.map((example,i) => <blockquote key={i}><p lang="en">{example.en}</p>{chineseVisible && example.zh && <footer>{example.zh}</footer>}{example.source === 'wordnet' && <small className="st-example-source">词典用法示例</small>}{example.source === 'tatoeba' && <small className="st-example-source">例句：<a href={'https://tatoeba.org/en/sentences/show/' + example.enId} target="_blank" rel="noreferrer">{example.enAuthor}</a>（{example.enLicense}）{example.zhId && <> · 译文：<a href={'https://tatoeba.org/en/sentences/show/' + example.zhId} target="_blank" rel="noreferrer">{example.zhAuthor}</a>（{example.zhLicense}）</>}</small>}</blockquote>)}</div> : <p className="st-unavailable">{resourcesLoaded ? '暂无可用例句。' : '正在加载词典…'}</p>}</section>
              {chineseVisible && card.note && card.note !== card.definitionZh && <section className="st-context-section st-note"><h3><span className="st-section-label">补充说明</span></h3><p>{card.note}</p></section>}
              {resourcesLoaded && study?.sources.length ? <p className="st-attribution">词典参考：{study.sources.includes('atlas') && <><a href="https://github.com/designfuchen/word-atlas" target="_blank" rel="noreferrer">Word Atlas contributors</a>（<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>，节选）</>}{study.sources.includes('ecdict') && <>{study.sources.includes('atlas') ? ' · ' : ''}<a href={publicPath('/uploads/ECDICT_LICENSE.txt')} target="_blank" rel="noreferrer">ECDICT（MIT）</a></>}{study.sources.includes('wordnet') && <> · <a href={publicPath('/uploads/WORDNET_LICENSE.txt')} target="_blank" rel="noreferrer">WordNet 3.0</a></>}{study.wiktionaryUrl && <> · <a href={study.wiktionaryUrl} target="_blank" rel="noreferrer">Wiktionary（改写，CC BY-SA）</a></>}{study.sources.includes('tatoeba') && <> · <a href="https://tatoeba.org/" target="_blank" rel="noreferrer">Tatoeba</a></>}。词典内容仅供参考。</p> : null}
            </aside>
          </div>
        </div>
      </main>
      <footer className="st-dock">
        <div className="st-dock-inner">
          <nav className="st-turner" aria-label="切换单词">
            <button aria-label="上一个单词" disabled={!previous} onClick={() => previous && goTo(previous.id)}><ArrowLeft size={19}/><span>{previous && previous.chapter !== card.chapter ? '上一章' : '上一个'}</span></button>
            <button className="st-dock-directory" aria-label="打开章节与词条" onClick={() => openFinder()}><List size={21}/><span>目录</span></button>
            <button className="next" aria-label={next ? '下一个单词' : '查看本书结尾'} onClick={() => next ? goTo(next.id) : setDialog('end')}><span>{!next ? '已到最后' : next.chapter !== card.chapter ? '下一章' : '下一个'}</span><ArrowRight size={19}/></button>
          </nav>
        </div>
      </footer>
    </div>

    {dialog === 'find' && <StudyDialog title={favoritesOnly ? '我的收藏' : '章节与词条'} close={() => setDialog(null)} wide>
      <label className="st-finder-input"><Search size={19}/><input type="search" aria-label="搜索单词、中文或搭配" placeholder={favoritesOnly ? '搜索收藏的单词…' : '搜索单词或中文…'} value={query} onChange={event => { setQuery(event.target.value); setResultPage(0) }}/></label>
      <div className="st-finder-meta"><select aria-label="搜索章节" value={searchChapter} onChange={event => { setSearchChapter(event.target.value); setResultPage(0) }}><option value="all">{favoritesOnly ? '全部收藏' : '全书'} · {favoritesOnly ? favoriteCount : words.length} 词</option>{course.chapters.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select><span>找到 {visibleResults.length} 个词条</span></div>
      <div className="st-results" ref={results}>{visibleResults.length ? course.chapters.map(item => {
        const matches = pagedResults.filter(word => word.chapter === item.id)
        return matches.length ? <section key={item.id}><h3>{item.name}<span>{visibleResults.filter(word => word.chapter === item.id).length} 词</span></h3>{matches.map(renderResult)}</section> : null
      }) : <div className="st-no-results"><Search size={27}/><strong>{favoritesOnly && !favoriteCount ? '还没有收藏的单词' : '没有找到匹配的词条'}</strong><p>{favoritesOnly && !favoriteCount ? '点击词卡右上角的星标，把想再看的词放在这里。' : '试试英文单词或更短的中文关键词。'}</p><button onClick={() => { setQuery(''); setSearchChapter('all'); if (!favoriteCount) setFavoritesOnly(false) }}>{favoritesOnly && favoriteCount ? '查看全部收藏' : '查看全书词条'}</button></div>}</div>
      {resultPages > 1 && <nav className="st-result-pages" aria-label="词条目录翻页"><button disabled={!currentResultPage} onClick={() => setResultPage(currentResultPage - 1)}><ArrowLeft size={16}/>上一页</button><span aria-live="polite">{currentResultPage * RESULT_PAGE_SIZE + 1}–{Math.min((currentResultPage + 1) * RESULT_PAGE_SIZE, visibleResults.length)} / {visibleResults.length}</span><button disabled={currentResultPage + 1 >= resultPages} onClick={() => setResultPage(currentResultPage + 1)}>下一页<ArrowRight size={16}/></button></nav>}
      <p className="st-dialog-foot">点选词条直接开始学习，位置会自动保存。</p>
    </StudyDialog>}
    {dialog === 'image' && <StudyDialog title={card.word + ' · 插画'} close={() => setDialog(null)} image>
      <div className={'st-image-view' + (imageZoom ? ' zoomed' : '')}><button aria-label={imageZoom ? '缩小插画' : '放大插画至两倍'} onClick={() => setImageZoom(value => !value)}><WordIllustration card={card} retry={imageRetry} frames={resources.frames} sourceUrl={card.imageZoomUrl || card.imageUrl} failed={() => {}}/></button></div><p className="st-dialog-foot">轻点图片{imageZoom ? '还原' : '放大'}，放大后可滑动查看。</p>
    </StudyDialog>}
    {dialog === 'end' && <StudyDialog title="已到本书最后一个单词" close={() => setDialog(null)}>
      <div className="st-end"><BookOpen size={34}/><p>本书共 {words.length} 个词条。可以从头再看一遍，也可以去目录选择想看的章节。</p><button className="st-primary" onClick={() => goTo(words[0].id)}><RotateCcw size={18}/>从第一个开始</button><button onClick={() => openFinder('all')}><List size={18}/>回到全书目录</button></div>
    </StudyDialog>}
    {dialog === 'keys' && <StudyDialog title="用键盘继续学习" close={() => setDialog(null)}><div className="st-key-list"><p><span>上一个 / 下一个单词</span><span><kbd>←</kbd> <kbd>→</kbd></span></p><p><span>播放 / 停止读音</span><kbd>Space</kbd></p><p><span>搜索全书</span><span><kbd>Ctrl K</kbd> / <kbd>/</kbd></span></p><p><span>关闭窗口</span><kbd>Esc</kbd></p></div><p className="st-dialog-foot">输入文字或操作按钮时，按键优先用于当前控件。</p></StudyDialog>}
    {dialog === 'review' && <StudyDialog title="回忆练习" close={() => { stopAudio(); setDialog(null) }}>
      {reviewQueue === null ? <div className="st-review st-review-setup">
        <p className="st-review-intro">{reviewMode === 'spelling' ? '看中文，输入英文拼写。' : '先看中文回忆英文，揭晓后自己判断。'}每次最多练习 20 个词。</p>
        <label>练习范围<select aria-label="练习范围" value={reviewScope} onChange={event => setReviewScope(event.target.value)}><option value="chapter">当前章节 · {chapter.name}</option><option value="all">全书</option><option value="favorites">我的收藏 · {favoriteCount} 词</option></select></label>
        <label>选词方式<select aria-label="选词方式" value={reviewFilter} onChange={event => setReviewFilter(event.target.value as 'mixed' | 'due' | 'new')}><option value="mixed">到期优先，再学新词</option><option value="due">只复习到期词</option><option value="new">只练未学过的词</option></select></label>
        <label>练习方式<select aria-label="练习方式" value={reviewMode} onChange={event => setReviewMode(event.target.value as 'recall' | 'spelling')}><option value="recall">回忆后自评</option><option value="spelling">输入英文拼写</option></select></label>
        <div className="st-review-stats"><span><strong>{reviewedCount}</strong>已练过</span><span><strong>{dueCount}</strong>到期复习</span><span><strong>{newCount}</strong>未练习</span></div>
        <p className="st-review-summary"><span>今天已练 {todayCount} 个词</span><span>本轮可练 {availableReview.length} 个词</span></p>
        {!availableReview.length && nextDue && <p>下次复习：{new Date(nextDue).toLocaleString('zh-CN', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' })}</p>}
        {!loaded && <p role="status">词库加载后即可开始练习。</p>}
        <button className="st-review-primary" disabled={!loaded || !availableReview.length} onClick={beginReview}>开始练习</button>
      </div> : reviewCard ? <div className="st-review" aria-live="polite">
        <p>第 {reviewStep + 1} / {reviewQueue.length} 词 · 看中文，回忆英文</p>
        {reviewCard.imageUrl && <div className="st-review-illustration"><WordIllustration card={reviewCard} retry={0} frames={resources.frames} decorative failed={() => {}}/></div>}
        <strong className="st-review-prompt">{reviewCard.meaningZh}</strong>
        {reviewRevealed ? <><div className="st-review-answer"><strong>{reviewCard.word}</strong><span>{reviewCard.ipa}</span>{reviewCard.audioUrl && <button className="st-review-audio" aria-label={playing ? '停止读音' : '播放 ' + reviewCard.word + ' 的读音'} onClick={() => playing ? stopAudio() : playAudioUrl(reviewCard.audioUrl)}>{playing ? <Pause size={16}/> : <Volume2 size={16}/>} {playing ? '停止' : '听读音'}</button>}</div>{audioError && <p role="alert">{audioError}</p>}{spellingMessage && <p role="status">{spellingMessage}</p>}<p>刚才想起来了吗？</p><div className="st-review-actions"><button onClick={() => gradeReview(false)}>没想起 · 稍后再看</button><button onClick={() => gradeReview(true)}>想起来了</button></div></> : reviewMode === 'spelling' ? <form className="st-spelling" onSubmit={event => { event.preventDefault(); checkSpelling() }}><label htmlFor="st-spelling-input">输入英文单词</label><input id="st-spelling-input" autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} value={spelling} onChange={event => { setSpelling(event.target.value); setSpellingMessage('') }}/>{spellingMessage && <p role="status">{spellingMessage}</p>}<button className="st-review-primary" type="submit">检查拼写</button><button type="button" className="st-review-secondary" onClick={() => { setSpellingMessage(''); setReviewRevealed(true) }}>查看答案</button></form> : <button className="st-review-primary" onClick={() => setReviewRevealed(true)}>显示答案</button>}
        {reviewError && <p role="alert">{reviewError}</p>}
      </div> : <div className="st-review"><strong className="st-review-prompt">本轮练习完成</strong><p>已完成 {reviewStep} 个词。没想起的词约 10 分钟后可再次练习；想起来的词会逐步延长复习间隔。</p><button className="st-review-primary" onClick={() => setReviewQueue(null)}>返回练习</button></div>}
    </StudyDialog>}
    {dialog === 'settings' && <StudyDialog title="学习设置" close={() => setDialog(null)}>
      <div className="st-card-shortcuts"><button onClick={openReview}><RotateCcw size={18}/>回忆练习<ChevronRight size={16}/></button><button onClick={() => openFinder('all')}><Search size={18}/>搜索词条<ChevronRight size={16}/></button><button onClick={() => openFinder(chapter.id)}><List size={18}/>本章目录<ChevronRight size={16}/></button><button onClick={() => openFinder('all', true)}><Star size={18}/>我的收藏<span className="st-count">{favoriteCount}</span><ChevronRight size={16}/></button></div>
      <div className="st-setting-list">
        <label className="st-setting-row"><span><strong>默认显示中文</strong><small>先看英文，再点击词卡查看中文。</small></span><input type="checkbox" role="switch" checked={options.chinese} onChange={event => changeOptions({ chinese: event.target.checked })}/></label>
        <label className="st-setting-row"><span><strong>翻词时自动播放</strong><small>切换到有读音的词条时，自动朗读。</small></span><input type="checkbox" role="switch" checked={options.auto} onChange={event => { initialFocus.current = true; changeOptions({ auto: event.target.checked }) }}/></label>
        <label className="st-setting-row"><span><strong>大字阅读</strong><small>放大释义、搭配和例句。</small></span><input type="checkbox" role="switch" checked={options.largeText} onChange={event => changeOptions({ largeText: event.target.checked })}/></label>
        <label className="st-setting-row"><span><strong>朗读语速</strong><small>选择适合自己的听读速度。</small></span><select aria-label="朗读语速" value={options.speed} onChange={event => changeOptions({ speed: Number(event.target.value) })}><option value={1}>正常</option><option value={0.8}>慢速 0.8×</option></select></label>
      </div>
      <p className="st-dialog-foot">{storageError ? '浏览器未能保存设置，本次使用仍有效。' : '设置会自动保存，下次打开继续使用。'}</p>
      <section className="st-backup" aria-label="学习记录备份">
        <strong>学习记录备份</strong><p>保存或恢复学习位置、收藏、复习记录和设置。</p>
        <div className="st-backup-actions"><button disabled={!loaded} onClick={exportProgress}>导出学习记录</button><button disabled={!loaded} onClick={() => backupInput.current?.click()}>选择备份文件</button><input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={event => void chooseBackup(event.target.files?.[0])}/></div>
        {!loaded && <p>词库加载后可备份学习记录。</p>}
        {pendingBackup && <div className="st-backup-confirm"><p>将恢复 {pendingBackup.favorites.length} 个收藏，并替换当前学习位置、设置{pendingBackup.reviews ? '和复习记录' : '（旧版备份不改变复习记录）'}。{pendingBackup.favorites.some(id => !words.some(word => word.id === id)) ? '部分收藏不在当前课程中，仍会保留在记录里。' : ''}</p><div className="st-backup-actions"><button onClick={confirmBackup}>确认恢复</button><button onClick={() => setPendingBackup(null)}>取消</button></div></div>}
        {backupMessage && <p role="status">{backupMessage}</p>}
      </section>
      <div className="st-settings-links"><button onClick={() => setDialog('keys')}><Keyboard size={17}/>键盘快捷键</button></div>
    </StudyDialog>}
  </div>
}
