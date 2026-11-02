import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ChevronLeft, ChevronRight, Expand, X } from 'lucide-react'
import type { ExampleLine, StudyContent } from './studyContent'
import './wordContext.css'

type Detail = 'definition' | 'phrases' | 'examples' | 'notes'
type WordContextProps = { content:StudyContent | null; chineseVisible:boolean; loaded:boolean; note?:string }

function Pager({ index, count, label, onChange }: {index:number; count:number; label:string; onChange:(index:number)=>void}) {
  if (count < 2) return null
  return <div className="wc-pager" aria-label={label + '切换'}>
    <button type="button" aria-label={'上一条' + label} disabled={index === 0} onClick={() => onChange(index - 1)}><ChevronLeft size={15}/></button>
    <span aria-live="polite">{index + 1} / {count}</span>
    <button type="button" aria-label={'下一条' + label} disabled={index + 1 === count} onClick={() => onChange(index + 1)}><ChevronRight size={15}/></button>
  </div>
}

function useOverflow(ref:RefObject<HTMLElement | null>, dependencies:unknown[]) {
  const [overflow, setOverflow] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) { setOverflow(false); return }
    const check = () => setOverflow(element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2)
    const observer = new ResizeObserver(check)
    observer.observe(element)
    for (const child of element.children) observer.observe(child)
    const frame = requestAnimationFrame(check)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, dependencies)
  return overflow
}

function ContextDialog({ title, close, children }: {title:string; close:()=>void; children:ReactNode}) {
  const ref = useRef<HTMLDialogElement>(null)
  const headingId = useId()
  useEffect(() => {
    const element = ref.current
    element?.showModal()
    return () => element?.close()
  }, [])
  return <dialog ref={ref} className="wc-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); close() }} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <header><h2 id={headingId}>{title}</h2><button type="button" aria-label="关闭详情" onClick={close}><X size={20}/></button></header>
    <div className="wc-dialog-body">{children}</div>
  </dialog>
}

function ExampleSource({ example, chineseVisible }: {example:ExampleLine; chineseVisible:boolean}) {
  return <small className="wc-example-source">
    {example.source === 'editorial' ? '词间整理' : example.source === 'course' ? '课程例句' : example.source === 'wordnet' ? 'WordNet 用法示例' : example.source === 'atlas' ? 'Word Atlas（CC BY 4.0，节选）' : <>
      例句：<a href={'https://tatoeba.org/en/sentences/show/' + example.enId} target="_blank" rel="noreferrer">{example.enAuthor}</a>（{example.enLicense}）
      {chineseVisible && example.zhId && <> · 译文：<a href={'https://tatoeba.org/en/sentences/show/' + example.zhId} target="_blank" rel="noreferrer">{example.zhAuthor}</a>（{example.zhLicense}）</>}
    </>}
    {chineseVisible && example.translationSource === 'editorial' && ' · 译文：词间整理'}
  </small>
}

export default function WordContext({ content, chineseVisible, loaded, note }: WordContextProps) {
  const [definitionIndex, setDefinitionIndex] = useState(0)
  const [exampleIndex, setExampleIndex] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const definitionBody = useRef<HTMLDivElement>(null)
  const phrasesBody = useRef<HTMLDivElement>(null)
  const exampleBody = useRef<HTMLDivElement>(null)
  const definitions = content?.definitions || []
  const examples = content?.examples || []
  const phrases = content?.phrases || []
  const activeDefinition = Math.min(definitionIndex, Math.max(0, definitions.length - 1))
  const examplePageSize = 1
  const examplePages = examples.length
  const activeExample = Math.min(exampleIndex, Math.max(0, examplePages - 1))
  const definition = definitions[activeDefinition]
  const visibleExamples = examples.slice(activeExample * examplePageSize, (activeExample + 1) * examplePageSize)
  const definitionOverflow = useOverflow(definitionBody, [content, activeDefinition, chineseVisible])
  const phrasesOverflow = useOverflow(phrasesBody, [content, chineseVisible])
  const exampleOverflow = useOverflow(exampleBody, [content, activeExample, chineseVisible])
  const titles:Record<Detail,string> = {definition:'完整词义', phrases:'常用搭配', examples:'语境例句', notes:'补充说明'}
  const expand = (kind:Detail, visible:boolean) => visible && <button className="wc-expand" type="button" aria-label={'展开' + titles[kind]} onClick={() => setDetail(kind)}><Expand size={12}/>展开</button>
  const empty = (what:string) => <p className="wc-empty">{loaded ? '暂无' + what + '。' : '正在加载词典…'}</p>
  const phraseList = <div className="wc-phrases">{phrases.map((phrase, index) => <div key={index}><p lang="en">{phrase.en}</p>{chineseVisible && phrase.zh && <small>{phrase.zh}</small>}</div>)}</div>

  return <aside className="st-context wc-context" aria-label="释义与用法">
    <header className="wc-heading"><h2>释义与用法</h2></header>

    <section className="wc-section wc-definition" aria-label="英文释义">
      <div className="wc-section-heading"><h3>英文释义</h3><div>{expand('definition', definitionOverflow)}<Pager index={activeDefinition} count={definitions.length} label="词义" onChange={setDefinitionIndex}/></div></div>
      <div className="wc-copy wc-definition-body" ref={definitionBody} aria-live="polite">
        {definition ? <><p className="wc-definition-en" lang="en">{definition.pos && <><span className="wc-pos">{definition.pos}</span>{' '}</>}{definition.en}</p>{chineseVisible && definition.zh && <p className="wc-translation">{definition.zh}</p>}</> : empty('英文释义')}
      </div>
    </section>

    <section className="wc-section wc-collocations" aria-label="常用搭配">
      <div className="wc-section-heading"><h3>常用搭配</h3><div>{expand('phrases', phrasesOverflow)}<small>{phrases.length} 组</small></div></div>
      <div className="wc-copy" ref={phrasesBody}>{phrases.length ? phraseList : empty('可用搭配')}</div>
    </section>

    <section className="wc-section wc-example" aria-label="语境例句">
      <div className="wc-section-heading"><h3>语境例句</h3><div>{expand('examples', exampleOverflow)}<Pager index={activeExample} count={examplePages} label="例句" onChange={setExampleIndex}/></div></div>
      {visibleExamples.length ? <div className="wc-copy wc-example-stack" ref={exampleBody} aria-live="polite">{visibleExamples.map((example, index) => <blockquote className="wc-example-body" key={activeExample * examplePageSize + index}><p lang="en">{example.en}</p>{chineseVisible && example.zh && <footer>{example.zh}</footer>}</blockquote>)}</div> : empty('可用例句')}
    </section>

    {chineseVisible && note && <footer className="wc-footer"><button type="button" onClick={() => setDetail('notes')}>补充说明</button></footer>}

    {detail && <ContextDialog title={titles[detail]} close={() => setDetail(null)}>
      {detail === 'definition' && <div className="wc-full-definitions">{definitions.map((item, index) => <section key={index}><p lang="en">{item.pos && <><span className="wc-pos">{item.pos}</span>{' '}</>}{item.en}</p>{chineseVisible && item.zh && <p className="wc-translation">{item.zh}</p>}</section>)}</div>}
      {detail === 'phrases' && phraseList}
      {detail === 'examples' && <div className="wc-full-examples">{examples.map((item, index) => <blockquote key={index}><p lang="en">{item.en}</p>{chineseVisible && item.zh && <footer>{item.zh}</footer>}<ExampleSource example={item} chineseVisible={chineseVisible}/></blockquote>)}</div>}
      {detail === 'notes' && <p>{note}</p>}
    </ContextDialog>}
  </aside>
}
