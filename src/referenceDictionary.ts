import { publicPath } from './publicPath.ts'
export interface DictionaryReference {
  senses: { pos:string; zh:string; en:string }[]
  examples: { en:string; zh:string }[]
  collocations: string[]
}
type RecordValue = Record<string, unknown>
const shortText = (value:unknown) => typeof value === 'string' ? value.slice(0, 1000) : ''
export function selectReference(word: {id:string; word:string; archived?:boolean}, data: unknown): DictionaryReference | null {
  if (word.archived || !data || typeof data !== 'object' || Array.isArray(data)) return null
  const dict = data as RecordValue
  if (dict.version !== 1 || !dict.entries || typeof dict.entries !== 'object' || Array.isArray(dict.entries) || !Object.hasOwn(dict.entries, word.id)) return null
  const entry = (dict.entries as RecordValue)[word.id] as RecordValue | null
  if (!entry || typeof entry !== 'object' || entry.word !== word.word) return null
  const senses = Array.isArray(entry.senses) ? entry.senses.slice(0, 3).map((s:RecordValue) => ({ pos:shortText(s?.pos), zh:shortText(s?.zh), en:shortText(s?.en) })).filter((s:DictionaryReference['senses'][number]) => s.zh || s.en) : []
  const examples = Array.isArray(entry.examples) ? entry.examples.slice(0, 2).map((ex:RecordValue) => ({ en:shortText(ex?.en), zh:shortText(ex?.zh) })).filter((ex:DictionaryReference['examples'][number]) => ex.en) : []
  const collocations = Array.isArray(entry.collocations) ? entry.collocations.slice(0, 4).map(shortText).filter(Boolean) : []
  return senses.length || examples.length || collocations.length ? { senses, examples, collocations } : null
}
let dictionaryPromise: Promise<unknown> | null = null
export function loadReferenceDictionary(): Promise<unknown> {
  if (!dictionaryPromise) dictionaryPromise = fetch(publicPath('/uploads/word-atlas-reference.json'), { cache:'no-store' }).then(response => {
    if (!response.ok) throw new Error('参考词典暂时无法读取。')
    return response.json() as Promise<unknown>
  }).catch(error => { dictionaryPromise = null; throw error })
  return dictionaryPromise
}
