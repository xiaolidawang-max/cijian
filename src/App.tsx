import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, Eye, EyeOff, ImageOff, Keyboard, List, Maximize2, Pause, RotateCcw, Search, Settings, Star, Volume2, X } from 'lucide-react'
import { assetUrl, chapters as originalChapters, words as originalWords } from './data'
import type { Course, CourseWord } from './workbench'
import { FAVORITES_KEY, OPTIONS_KEY, POSITION_KEY, parseStudyBackup, restoreStudyBackup } from './studyBackup'
import type { StudyBackup, StudyOptions } from './studyBackup'
import { readReviewRecords } from './studyReview'
import { readChapterPositions, readReviewSession, savePosition, toggleFavorite as saveFavorite, updateOptions, subscribeStudyChanges, withStudyLock } from './studyStorage'
import { buildStudyContent } from './studyContent'
import { publicPath } from './publicPath'
import Home from './Home'
import BookLibrary from './BookLibrary'
import WordContext from './WordContext'
import StudySidebar from './StudySidebar'
import { useMobileLayout } from './useMobileLayout'
import { useStudyNavigation } from './useStudyNavigation'
import { saveStudyBackupFile } from './saveStudyBackupFile'
import type { StudyPage } from './useStudyNavigation'
import './study.css'
import './mobileHome.css'
import './mobile.css'

const seed: Course = {
  title: '雅思词汇真经', description: '图文刷词 · 打开即学', chapters: originalChapters,
  words: originalWords.map(word => ({ ...word, imageUrl: assetUrl(word.chapter === 'plants' ? 'study-images' : 'images', word.image), audioUrl: word.audio ? assetUrl('audio', word.audio) : '', imageName: word.image, audioName: word.audio || '', reviewed: false, archived: false })),
}
function readPosition() {
  try { return localStorage.getItem(POSITION_KEY) || '' } catch { return '' }
}
function readFavorites(): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string'))] : [] } catch { return [] }
}
function readOptions(): StudyOptions {
  try {
    const value = JSON.parse(localStorage.getItem(OPTIONS_KEY) || '{}')
    return { chinese: value.chinese !== false, auto: value.auto === true, speed: value.speed === 0.8 ? 0.8 : 1, largeText: value.largeText === true, imageSize: value.imageSize === 240 || value.imageSize === 360 ? value.imageSize : 300 }
  } catch { return { chinese: true, auto: false, speed: 1, largeText: false } }
}
const pad = (value: number) => String(value).padStart(2, '0')
const RESULT_PAGE_SIZE = 60
// Use a representative topic image, rather than whichever word happens to be first.
const chapterCovers:Record<string,string> = { geography:'atmosphere', plants:'vegetation', ch03:'wildlife', ch04:'galaxy', ch05:'university', ch06:'technology', ch07:'civilisation', ch08:'language', ch09:'stadium', ch10:'material', ch11:'fashion', ch12:'diet', ch13:'architecture', ch14:'travel', ch15:'government', ch16:'market', ch17:'law', ch18:'battle', ch19:'couple', ch20:'act', ch21:'brain', ch22:'dawn' }

interface PhotoFrame { url:string; left:number; top:number; width:number; height:number; background:string }
type StudyResources = { atlas:unknown; ecdict:unknown; phrases:unknown; wordnet:unknown; wordnetDefinitions:unknown; wiktionary:unknown; tatoeba:unknown; tatoebaEnglish:unknown; frames:Record<string, PhotoFrame> }
const emptyResources: StudyResources = { atlas:null, ecdict:null, phrases:null, wordnet:null, wordnetDefinitions:null, wiktionary:null, tatoeba:null, tatoebaEnglish:null, frames:{} }
function WordIllustration({ card, retry, failed, frames, sourceUrl, decorative = false, cropPhoto = false, overlay }: { card:CourseWord; retry:number; failed:()=>void; frames:Record<string, PhotoFrame>; sourceUrl?:string; decorative?:boolean; cropPhoto?:boolean; overlay?:ReactNode }) {
  const frame = card.imageFrame
  const rounded = frames[card.id]
  const alt = decorative ? '' : card.imageAlt || card.word + ' 插画'
  if (cropPhoto && !frame && rounded?.url === card.imageUrl && rounded.width > 0 && rounded.height > 0) return <span className="st-image-crop" style={{ width:'min(100%,calc(var(--st-image-height) * ' + rounded.width / rounded.height + '))', aspectRatio:rounded.width / rounded.height }}><img key={card.id + '-' + retry} src={sourceUrl || card.imageUrl} alt={alt} draggable={false} onError={failed} style={{ width:100 / rounded.width + '%', height:100 / rounded.height + '%', left:-100 * rounded.left / rounded.width + '%', top:-100 * rounded.top / rounded.height + '%' }}/>{overlay}</span>
  if (!frame && rounded?.url === card.imageUrl && rounded.width > 0 && rounded.height > 0) return <span className="st-art-canvas" style={{ background:rounded.background }}><span className="st-art-frame" style={{ left:rounded.left * 100 + '%', top:rounded.top * 100 + '%', width:rounded.width * 100 + '%', height:rounded.height * 100 + '%' }}><img key={card.id + '-' + retry} src={sourceUrl || card.imageUrl} alt={alt} draggable={false} onError={failed} style={{ width:100 / rounded.width + '%', height:100 / rounded.height + '%', left:-100 * rounded.left / rounded.width + '%', top:-100 * rounded.top / rounded.height + '%' }}/></span>{overlay}</span>
  const picture = <img key={card.id + '-' + retry} src={sourceUrl || card.imageUrl} alt={alt} draggable={false} onError={failed} style={frame ? { width:100 / frame.width + '%', height:100 / frame.height + '%', left:-100 * frame.left / frame.width + '%', top:-100 * frame.top / frame.height + '%' } : undefined}/>
  return frame ? <span className="st-image-crop" style={{ width:'min(100%,calc(var(--st-image-height) * ' + frame.aspectRatio + '))', aspectRatio:frame.aspectRatio }}>{picture}{overlay}</span> : <span className="st-art-canvas st-whole-art">{picture}{overlay}</span>
}

function StudyDialog({ title, children, close, wide = false, image = false, className = '' }: { title: string; children: ReactNode; close: () => void; wide?: boolean; image?: boolean; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])
  return <dialog ref={ref} className={'st-dialog' + (wide ? ' wide' : '') + (image ? ' st-image-dialog' : '') + (className ? ' ' + className : '')} aria-labelledby="study-dialog-title" onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="st-dialog-inner"><span className="st-sheet-handle" aria-hidden="true"/><header><h2 id="study-dialog-title">{title}</h2><button className="st-icon" aria-label="关闭窗口" onClick={close}><X size={20}/></button></header>{children}</div>
  </dialog>
}

export default function App() {
  const mobile = useMobileLayout()
  const { page, dialog, navigate, setDialog } = useStudyNavigation(mobile, () => {
    stopAudio()
    setReadingBar(false)
  })
  const showHome = page !== 'study'
  const [hasStarted, setHasStarted] = useState(() => !!readPosition())
  const [chapterPositions, setChapterPositions] = useState(readChapterPositions)
  const [favoriteSaving, setFavoriteSaving] = useState(false)
  const [course, setCourse] = useState<Course>(seed)
  const [resources, setResources] = useState<StudyResources>(emptyResources)
  const [resourcesLoaded, setResourcesLoaded] = useState(false)
  const [resourceErrors, setResourceErrors] = useState(0)
  const [resourceRetry, setResourceRetry] = useState(0)
  const [selectedId, setSelectedId] = useState(readPosition)
  const [favorites, setFavorites] = useState(readFavorites)
  const [options, setOptions] = useState(readOptions)
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
  const [exportingBackup, setExportingBackup] = useState(false)
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

  useEffect(() => {
    if (!mobile && dialog === 'chapters') setDialog(null)
  }, [mobile, dialog])

  const words = useMemo(() => course.chapters.flatMap(chapter => course.words.filter(word => word.chapter === chapter.id && !word.archived)), [course])
  const index = Math.max(0, words.findIndex(word => word.id === selectedId))
  const card = words[index]
  const photoFrame = card && resources.frames[card.id]
  const illustrationRatio = card?.imageFrame?.aspectRatio || (photoFrame && photoFrame.url === card.imageUrl && photoFrame.width > 0 && photoFrame.height > 0 ? photoFrame.width / photoFrame.height : 1)
  const study = useMemo(() => card ? buildStudyContent(card, resources.atlas, resources.ecdict, resources.phrases, resources.wordnet, resources.tatoeba, resources.wordnetDefinitions, resources.wiktionary, resources.tatoebaEnglish) : null, [card, resources])
  const chineseVisible = answerOverride?.id === card?.id ? answerOverride?.show : options.chinese
  const chapter = course.chapters.find(item => item.id === card?.chapter) || course.chapters[0]
  const chapterWords = words.filter(word => word.chapter === chapter?.id)
  const chapterIndex = chapterWords.findIndex(word => word.id === card?.id)
  const previous = words[index - 1]
  const next = words[index + 1]
  const starred = favorites.includes(card?.id)
  const position = chapterIndex + 1
  const searchIndex = useMemo(() => {
    const index = new Map<string, string>()
    for (const word of words) {
      const content = resourcesLoaded ? buildStudyContent(word, resources.atlas, resources.ecdict, resources.phrases, resources.wordnet, resources.tatoeba, resources.wordnetDefinitions, resources.wiktionary, resources.tatoebaEnglish) : null
      const text = [word.word, ...(content?.senses.length ? content.senses.map(sense => sense.meaning) : [word.meaningZh]), ...(content ? content.phrases.flatMap(phrase => [phrase.en, phrase.zh]) : [...word.phrases, ...word.phraseTranslations])]
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

  useEffect(() => subscribeStudyChanges(() => {
    setFavorites(readFavorites())
    setOptions(readOptions())
    setChapterPositions(readChapterPositions())
    setHasStarted(!!readPosition())
    if (showHome && !dialog) setSelectedId(readPosition())
  }), [showHome, dialog])

  async function changeOptions(value: Partial<typeof options>) {
    try {
      setOptions(await updateOptions(value))
      if ('chinese' in value) setAnswerOverride(null)
      setStorageError(false)
    } catch { setStorageError(true) }
  }
  const stopAudio = useCallback(() => {
    const player = audio.current
    if (player) { player.pause(); player.onended = null; player.onerror = null; audio.current = null }
    setPlaying(false)
  }, [])

  const navigatePage = useCallback((destination:StudyPage) => {
    stopAudio()
    setReadingBar(false)
    navigate(destination)
  }, [navigate, stopAudio])

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
    setHasStarted(true)
    navigate('study')
    setAnswerOverride(null)
    setReadingBar(false)
    const word = words.find(item => item.id === id)!
    void savePosition(word.chapter, id, hasStarted && card ? { chapterId:card.chapter, wordId:card.id } : undefined).then(value => { setChapterPositions(value); setStorageError(false) }).catch(() => setStorageError(true))
    main.current?.scrollTo({ top: 0, behavior: 'instant' })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [words, stopAudio, hasStarted, card, navigate])
  const openFinder = useCallback((scope = chapter?.id || 'all', collection = false) => {
    setQuery('')
    setSearchChapter(scope)
    setFavoritesOnly(collection)
    const matches = words.filter(word => (scope === 'all' || word.chapter === scope) && (!collection || favorites.includes(word.id)))
    setResultPage(Math.floor(Math.max(0, matches.findIndex(word => word.id === card?.id)) / RESULT_PAGE_SIZE))
    setDialog('find')
  }, [chapter?.id, words, favorites, card?.id])
  async function toggleFavorite() {
    if (!card || favoriteSaving) return
    setFavoriteSaving(true)
    try { setFavorites(await saveFavorite(card.id)); setStorageError(false) }
    catch { setStorageError(true) }
    finally { setFavoriteSaving(false) }
  }

  async function exportProgress() {
    if (exportingBackup) return
    setExportingBackup(true)
    try {
      // Preserve legacy fields in exported backups without exposing the removed feature.
      const backup: StudyBackup = await withStudyLock(() => ({ format:'wordspace-study-backup', version:3, exportedAt:new Date().toISOString(), position:readPosition() || card.id, favorites:readFavorites(), options:readOptions(), reviews:readReviewRecords(), chapterPositions:readChapterPositions(), reviewSession:readReviewSession() }))
      const result = await saveStudyBackupFile('词间学习记录-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(backup, null, 2))
      setBackupMessage(result === 'saved' ? '学习记录已保存。' : result === 'cancelled' ? '已取消保存。' : '已开始下载学习记录。请妥善保存备份文件。')
    } catch { setBackupMessage('未能导出学习记录，请重试。') }
    finally { setExportingBackup(false) }
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
  async function confirmBackup() {
    if (!pendingBackup) return
    try {
      await restoreStudyBackup(localStorage, pendingBackup)
      stopAudio()
      setSelectedId(pendingBackup.position)
      setHasStarted(true)
      setChapterPositions(readChapterPositions())
      setFavorites(pendingBackup.favorites)
      setOptions(pendingBackup.options)
      setAnswerOverride(null)
      setStorageError(false)
      setPendingBackup(null)
      setBackupMessage('学习记录已恢复。')
    } catch { setBackupMessage('无法写入浏览器存储，请检查存储权限后重试。') }
  }
  useEffect(() => {
    let active = true
    const controllers:AbortController[] = []
    setResourcesLoaded(false)
    setResourceErrors(0)
    const files: [keyof StudyResources, string][] = [
      ['atlas','word-atlas-reference.json'], ['ecdict','ecdict-reference.json'], ['phrases','course-phrases.json'],
      ['wordnet','wordnet-examples.json'], ['frames','rounded-photo-frames.json'], ['tatoeba','tatoeba-examples.json'],
      ['wordnetDefinitions','wordnet-definitions.json'], ['wiktionary','wiktionary-definitions.json'], ['tatoebaEnglish','tatoeba-english-examples.json'],
    ]
    void Promise.allSettled(files.map(async ([key, name]) => {
      const controller = new AbortController()
      controllers.push(controller)
      const timer = window.setTimeout(() => controller.abort(), 10_000)
      try {
        const response = await fetch(publicPath('/uploads/' + name), { signal:controller.signal })
        if (!response.ok) throw new Error('词典资料暂时不可用')
        let value = await response.json()
        if (key === 'frames') value = value?.version === 1 && value.frames ? Object.fromEntries(Object.entries(value.frames as Record<string,PhotoFrame>).map(([id, frame]) => [id, { ...frame, url:publicPath(frame.url) }])) : {}
        if (active) setResources(previous => ({ ...previous, [key]:value }))
      } catch { if (active) setResourceErrors(count => count + 1) }
      finally { window.clearTimeout(timer) }
    })).then(() => { if (active) setResourcesLoaded(true) })
    return () => { active = false; controllers.forEach(controller => controller.abort()) }
  }, [resourceRetry])

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
  useEffect(() => { if (card) document.title = !loaded && online ? '正在加载 · 词间' : page === 'library' ? '选择词书 · 词间' : page === 'chapters' ? course.title + ' · 词间' : card.word + ' · 词间' }, [card?.word, course.title, loaded, online, page])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (showHome || dialog || document.querySelector('dialog[open]') || event.altKey || event.repeat) return
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
  }, [showHome, dialog, previous, next, card?.audioUrl, playing, playAudio, stopAudio, goTo, openFinder])

  useEffect(() => {
    const root = main.current
    const target = heading.current
    if (!root || !target) return
    const observer = new IntersectionObserver(([entry]) => setReadingBar(!entry.isIntersecting && entry.boundingClientRect.bottom < (entry.rootBounds?.top || 0)), { root })
    observer.observe(target)
    return () => observer.disconnect()
  }, [card?.id, loaded, online, showHome])
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

  const renderResult = (word: CourseWord) => {
    const content = buildStudyContent(word, resources.atlas, resources.ecdict, resources.phrases, resources.wordnet, resources.tatoeba, resources.wordnetDefinitions, resources.wiktionary, resources.tatoebaEnglish)
    return <button key={word.id} ref={word.id === card?.id ? activeResult : undefined} aria-current={word.id === card?.id ? 'true' : undefined} className={'st-result' + (word.id === card?.id ? ' selected' : '')} aria-label={'打开单词 ' + word.word} onClick={() => goTo(word.id)}>
      <span><strong>{word.word}</strong>{options.chinese && <small>{content.senses.map(sense => [sense.pos, sense.meaning].filter(Boolean).join(' ')).join(' · ')}</small>}</span>{word.id === card?.id && <em>当前</em>}{favorites.includes(word.id) && <Star size={14} className="st-starred"/>}<ChevronRight size={15}/>
    </button>
  }

  if (!loaded && online) return <div className="st-empty-page" role="status"><BookOpen size={32}/><h1>正在加载课程</h1><p>请稍候，正在读取你的词库。</p></div>
  if (!loaded) return <div className="st-empty-page" role="alert"><BookOpen size={32}/><h1>词库暂时未能打开</h1><p>学习记录仍保存在本机，请重新读取词库。</p><button onClick={() => window.location.reload()}>重新读取</button></div>
  if (!card || !chapter) return <div className="st-empty-page"><BookOpen size={32}/><h1>暂时没有可学习的词条</h1><p>请检查词库文件后刷新页面。</p></div>

  const notice = storageError ? '未能保存学习记录，请检查存储设置。' : undefined
  const home = <Home
    title={course.title}
    onHome={() => navigatePage('library')}
    hasStarted={hasStarted}
    chapter={chapter.name}
    chapterNumber={course.chapters.findIndex(item => item.id === chapter.id) + 1}
    chapterTotal={chapterWords.length}
    chapterPosition={position}
    word={card.word}
    illustration={!loaded || imageError || !card.imageUrl ? null : <WordIllustration card={card} retry={imageRetry} frames={resources.frames} failed={() => setImageError(true)} decorative cropPhoto/>}
    totalWords={words.length}
    chapters={course.chapters.map(item => {
      const entries = words.filter(word => word.chapter === item.id)
      const remembered = chapterPositions[item.id] || (hasStarted && card.chapter === item.id ? card.id : '')
      const savedPosition = entries.findIndex(word => word.id === remembered) + 1
      const cover = entries.find(word => word.word === chapterCovers[item.id]) || entries[0]
      return { id:item.id, name:item.name, count:entries.length, imageUrl:loaded ? cover?.imageUrl || '' : '', savedPosition }
    })}
    notice={notice}
    onStudy={() => goTo(card.id)}
    onDirectory={() => openFinder('all')}
    onFavorites={() => openFinder('all', true)}
    onChapter={id => {
      const first = words.find(word => word.chapter === id)
      if (!first) return
      const remembered = chapterPositions[id] || (hasStarted && chapter.id === id ? card.id : '')
      const destination = words.find(word => word.chapter === id && word.id === remembered) || first
      goTo(destination.id)
    }}
  />

  const library = <BookLibrary
    title={course.title}
    chapterCount={course.chapters.length}
    wordCount={words.length}
    hasStarted={hasStarted}
    chapter={chapter.name}
    chapterPosition={position}
    chapterTotal={chapterWords.length}
    notice={notice}
    onOpenBook={() => navigatePage('chapters')}
    onStudy={() => goTo(card.id)}
    onFavorites={() => openFinder('all', true)}
    onSettings={() => setDialog('settings')}
  />

  return <>{showHome && (page === 'library' ? library : home)}<div className={'st-shell' + (options.largeText ? ' st-large-text' : '') + (showHome ? ' st-overlay-only' : '')} style={{ '--st-picture-size':(options.imageSize ?? 300) + 'px' } as CSSProperties}>
    {!showHome && <a className="st-skip" href="#study-content">跳到当前词卡</a>}
    {loaded && <div className="st-workspace" style={{ display:showHome ? 'none' : undefined }}>
      <header className="st-app-header">
        <button className="st-app-brand" aria-label="返回词间主页" onClick={() => navigatePage('library')}>词间</button>
        <nav aria-label="学习导航">
          <button onClick={() => navigatePage('library')}>首页</button>
          <button aria-current={dialog === 'find' && favoritesOnly ? undefined : 'page'} onClick={() => setDialog(null)}>学习</button>
          <button aria-current={dialog === 'find' && favoritesOnly ? 'page' : undefined} onClick={() => openFinder('all', true)}>收藏</button>
        </nav>
        {!mobile && <button className="st-icon st-app-settings" aria-label="学习设置" title="学习设置" aria-haspopup="dialog" onClick={() => setDialog('settings')}><Settings size={20}/></button>}
      </header>
      {readingBar && <div className="st-reading-bar"><strong>{card.word}</strong><button className="st-icon" aria-label={chineseVisible ? '隐藏中文' : '显示中文'} aria-pressed={chineseVisible} onClick={() => changeOptions({ chinese: !chineseVisible })}>{chineseVisible ? <EyeOff size={18}/> : <Eye size={18}/>}</button><button className={'st-play' + (playing ? ' playing' : '')} disabled={!card.audioUrl} aria-label={playing ? '停止读音' : '播放 ' + card.word + ' 的读音'} onClick={() => { initialFocus.current = true; if (playing) stopAudio(); else playAudio() }}>{playing ? <Pause size={17}/> : <Volume2 size={18}/>}<span>{playing ? '播放中' : '听读音'}</span></button></div>}
      <main className="st-main" ref={main} id="study-content" tabIndex={-1}>
        <div className="st-content">
          {!online && <p className="st-notice" role="status">词库加载失败，请刷新页面重试。</p>}
          {!!resourceErrors && <p className="st-notice" role="status">部分词典资料未能载入。<button onClick={() => setResourceRetry(value => value + 1)}>重试</button></p>}
          {storageError && <p className="st-notice" role="alert">浏览器未能保存学习记录，本次仍可继续浏览。</p>}
          <div className="st-reading-grid">
            {!mobile && <StudySidebar key={showHome ? 'home' : 'study'} chapters={course.chapters} words={words} selectedId={card.id} favorites={favorites} onSelect={goTo}/>}
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
                  {mobile ? <button className="st-card-meta st-mobile-chapter" aria-label={'打开章节目录，' + chapter.name + '，' + position + ' / ' + chapterWords.length} onClick={() => setDialog('chapters')}><span>{chapter.name}</span><small>{position} / {chapterWords.length}</small><ChevronDown size={13}/></button> : <p className="st-card-meta">{chapter.name}<span>·</span>{position} / {chapterWords.length}</p>}
                  <div className="st-card-actions"><button className="st-icon" aria-label={chineseVisible ? '隐藏中文' : '显示中文'} title={chineseVisible ? '隐藏中文（记住选择）' : '显示中文（记住选择）'} aria-pressed={chineseVisible} onClick={() => changeOptions({ chinese: !chineseVisible })}>{chineseVisible ? <EyeOff size={17}/> : <Eye size={17}/>}</button><button className="st-icon st-favorite" aria-label={starred ? '取消收藏单词' : '收藏单词'} title={starred ? '取消收藏' : '收藏单词'} aria-pressed={starred} disabled={favoriteSaving} onClick={toggleFavorite}><Star size={22} fill={starred ? 'currentColor' : 'none'}/></button><button className="st-icon" aria-label="词卡设置" title="词卡设置" aria-haspopup="dialog" onClick={() => setDialog('settings')}><Settings size={19}/></button></div>
                </header>
                <div className="st-card-body">
                <div className="st-lexeme" ref={heading} aria-live="polite">
                  <h2 className={card.word.length > 18 ? 'st-long-word' : undefined}>{card.word}</h2>
                  <div className="st-pronunciation"><span>{card.ipa || '音标待补充'}</span><button className={'st-play' + (playing ? ' playing' : '')} aria-label={playing ? '停止读音' : '播放 ' + card.word + ' 的读音'} disabled={!card.audioUrl} onClick={() => { initialFocus.current = true; if (playing) stopAudio(); else playAudio() }}>{playing ? <Pause size={17}/> : <Volume2 size={18}/>}<span>{playing ? '播放中' : card.audioUrl ? '听读音' : '暂无读音'}</span></button></div>
                  <div className="st-meaning-slot">{chineseVisible ? <div className="st-meanings" aria-label="中文释义">{study?.senses.length ? study.senses.map((sense, i) => <div className="st-meaning-row" key={i}>{sense.pos && <span className="st-pos">{sense.pos}</span>}<span>{sense.meaning}</span></div>) : <p className="st-meaning">{card.meaningZh || '中文释义待补充'}</p>}</div> : <button className="st-reveal" aria-label="查看当前词释义" title="仅显示当前词，后续单词继续隐藏" onClick={() => setAnswerOverride({ id: card.id, show: true })}>查看释义<ChevronDown size={13}/></button>}</div>
                </div>

                <div className="st-illustration" style={{ aspectRatio:illustrationRatio }}>
                  {imageError || !card.imageUrl ? <div className="st-image-fallback" role="status"><ImageOff size={28}/><span>{card.imageUrl ? '插画暂时无法读取' : '这张词卡还没有插画'}</span>{card.imageUrl && <button onClick={() => { setImageError(false); setImageRetry(value => value + 1) }}>重新加载</button>}</div> : <button className="st-image-open" aria-label={'放大 ' + card.word + ' 的插画'} onClick={() => { if (Date.now() < suppressImageTapUntil.current) return; setImageZoom(false); setDialog('image') }}><WordIllustration card={card} retry={imageRetry} frames={resources.frames} failed={() => setImageError(true)} cropPhoto overlay={<span className="st-image-hint" aria-hidden="true"><Maximize2 size={14}/></span>}/></button>}
                </div>
                {audioError && <p className="st-audio-error" role="alert">{audioError}</p>}
      <footer className="st-dock">
        <div className="st-dock-inner">
          <nav className="st-turner" aria-label="切换单词">
            <button aria-label="上一个单词" disabled={!previous} onClick={() => previous && goTo(previous.id)}><ArrowLeft size={19}/><span>{previous && previous.chapter !== card.chapter ? '上一章' : '上一个'}</span></button>
            <button className="st-dock-directory" aria-label="打开章节与词条" onClick={() => mobile ? setDialog('chapters') : openFinder()}><List size={21}/><span>目录</span></button>
            <button className="next" aria-label={next ? '下一个单词' : '查看本书结尾'} onClick={() => next ? goTo(next.id) : setDialog('end')}><span>{!next ? '已到最后' : next.chapter !== card.chapter ? '下一章' : '下一个'}</span><ArrowRight size={19}/></button>
          </nav>
        </div>
      </footer>
                </div>
              </article>
            </div>

            {!showHome && <WordContext key={card.id} content={study} chineseVisible={chineseVisible} loaded={resourcesLoaded} flowing={mobile} note={card.note !== card.definitionZh ? card.note : undefined}/>}
          </div>
        </div>
      </main>

    </div>}

    {mobile && dialog === 'chapters' && <StudyDialog title="章节目录" className="st-chapters-dialog" close={() => setDialog(null)}>
      <StudySidebar chapters={course.chapters} words={words} selectedId={card.id} favorites={favorites} onSelect={goTo}/>
    </StudyDialog>}
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
    {dialog === 'settings' && <StudyDialog title="学习设置" className="st-settings-dialog" close={() => setDialog(null)}>
      <div className="st-setting-list">
        <label className="st-setting-row"><span><strong>显示中文</strong><small>与眼睛按钮同步，切词后保持。</small></span><input type="checkbox" role="switch" checked={options.chinese} onChange={event => changeOptions({ chinese: event.target.checked })}/></label>
        <label className="st-setting-row"><span><strong>字号</strong><small>调整释义、搭配和例句的文字大小。</small></span><select aria-label="字号" value={options.largeText ? 'large' : 'normal'} onChange={event => changeOptions({ largeText: event.target.value === 'large' })}><option value="normal">标准</option><option value="large">较大</option></select></label>
        <label className="st-setting-row"><span><strong>图片大小</strong><small>点击词卡图片仍可放大查看。</small></span><select aria-label="图片大小" value={options.imageSize ?? 300} onChange={event => changeOptions({ imageSize: Number(event.target.value) as StudyOptions['imageSize'] })}><option value={240}>较小</option><option value={300}>标准</option><option value={360}>较大</option></select></label>
        <label className="st-setting-row"><span><strong>翻词时自动播放</strong><small>切换到有读音的词条时，自动朗读。</small></span><input type="checkbox" role="switch" checked={options.auto} onChange={event => { initialFocus.current = true; changeOptions({ auto: event.target.checked }) }}/></label>
        <label className="st-setting-row"><span><strong>朗读语速</strong></span><select aria-label="朗读语速" value={options.speed} onChange={event => changeOptions({ speed: Number(event.target.value) })}><option value={1}>正常</option><option value={0.8}>慢速 0.8×</option></select></label>
      </div>
      <p className="st-dialog-foot">{storageError ? '设置未能保存，请检查浏览器存储权限后重试。' : '设置会自动保存，下次打开继续使用。'}</p>
      <details className="st-backup">
        <summary>学习记录备份<ChevronDown size={15}/></summary>
        <div className="st-backup-body"><p>保存或恢复学习位置、章节进度、收藏和设置。</p>
        <div className="st-backup-actions"><button disabled={!loaded || exportingBackup} onClick={exportProgress}>{exportingBackup ? '正在保存…' : '导出学习记录'}</button><button disabled={!loaded} onClick={() => backupInput.current?.click()}>选择备份文件</button><input ref={backupInput} type="file" accept=".json,application/json" hidden onChange={event => void chooseBackup(event.target.files?.[0])}/></div>
        {!loaded && <p>词库加载后可备份学习记录。</p>}
        {pendingBackup && <div className="st-backup-confirm"><p>将恢复 {pendingBackup.favorites.length} 个收藏，并替换当前学习位置和设置。{pendingBackup.version < 3 ? '这份旧版备份不包含各章位置，恢复时会清除现有章节进度。' : '各章位置也会替换为备份中的内容。'}{pendingBackup.favorites.some(id => !words.some(word => word.id === id)) ? '部分收藏不在当前课程中，仍会保留在记录里。' : ''}</p><div className="st-backup-actions"><button onClick={confirmBackup}>确认恢复</button><button onClick={() => setPendingBackup(null)}>取消</button></div></div>}
        {backupMessage && <p role="status">{backupMessage}</p>}</div>
      </details>
      <div className="st-settings-links"><button onClick={() => setDialog('keys')}><Keyboard size={17}/>键盘快捷键</button></div>
    </StudyDialog>}
  </div></>
}
