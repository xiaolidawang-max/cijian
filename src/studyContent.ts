import { selectReference } from './referenceDictionary.ts'
import type { CourseWord } from './workbench.ts'

export interface SenseLine { pos:string; meaning:string }
export interface PhraseLine { en:string; zh:string }
export interface ExampleLine { en:string; zh:string; source:'course' | 'atlas' | 'wordnet' | 'tatoeba'; enAuthor?:string; zhAuthor?:string; enLicense?:string; zhLicense?:string; enId?:number; zhId?:number }
export interface DefinitionLine { pos:string; en:string; zh:string }
export interface StudyContent { senses:SenseLine[]; definitions:DefinitionLine[]; phrases:PhraseLine[]; examples:ExampleLine[]; sources:string[]; wiktionaryUrl?:string }
type Entry = Record<string, unknown>
const specialNouns = new Set(['alumni','bacteria','benchmark','biorhythm','carbon dioxide','dining hall','eaves','health care','heart attack','ice cream','living room','meltdown','new zealand','science fiction'])
function entryFor(word: CourseWord, data:unknown): Entry | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const dict = data as Entry
  if (dict.version !== 1 || !dict.entries || typeof dict.entries !== 'object' || Array.isArray(dict.entries) || !Object.hasOwn(dict.entries, word.id)) return null
  const entry = (dict.entries as Entry)[word.id]
  return entry && typeof entry === 'object' && !Array.isArray(entry) && (entry as Entry).word === word.word ? entry as Entry : null
}
export function parseEcdictSenses(translation: string): SenseLine[] {
  const lines = translation.replaceAll('\\n', '\n').split(/\r?\n/)
  const senses: SenseLine[] = []
  for (const line of lines) {
    const match = line.trim().match(/^(n|v|vt|vi|adj|a|adv|prep|conj|pron|num|int|interj|abbr|pl|art|det)\.\s*(.+)$/i)
    if (!match) continue
    const kind = match[1].toLowerCase()
    const pos = kind === 'a' ? 'adj.' : kind === 'pl' ? 'n. pl.' : kind + '.'
    const meaning = match[2].trim().replace(/,\s*/g, '；')
    if (meaning) senses.push({ pos, meaning })
  }
  return senses
}
function groupSenses(lines: SenseLine[]): SenseLine[] {
  const result: SenseLine[] = []
  for (const sense of lines) {
    const found = result.find(row => row.pos === sense.pos)
    if (found) {
      const parts = found.meaning.split('；')
      for (const text of sense.meaning.split('；').map(x => x.trim()).filter(Boolean)) if (!parts.includes(text)) parts.push(text)
      found.meaning = parts.join('；')
    } else result.push({ ...sense })
  }
  return result
}
export function buildStudyContent(word: CourseWord, atlasData:unknown, ecdictData:unknown, phraseData:unknown, wordnetData:unknown, tatoebaData?:unknown, wordnetDefinitionsData?:unknown, wiktionaryData?:unknown, tatoebaEnglishData?:unknown): StudyContent {
  const atlas = selectReference(word, atlasData)
  const ecdict = entryFor(word, ecdictData)
  const ownPhrase = entryFor(word, phraseData)
  const wordnet = entryFor(word, wordnetData)
  const tatoeba = entryFor(word, tatoebaData)
  const tatoebaEnglish = entryFor(word, tatoebaEnglishData)
  const wordnetDefinitions = entryFor(word, wordnetDefinitionsData)
  const wiktionary = entryFor(word, wiktionaryData)
  const atlasSenses = atlas?.senses.filter(s => s.pos && s.zh).map(s => ({ pos:s.pos, meaning:s.zh })) || []
  const ecdictSenses = typeof ecdict?.translation === 'string' ? parseEcdictSenses(ecdict.translation) : []
  // Keep original course meanings that the dictionary can assign to a part
  // of speech, even when the other reference omits that particular sense.
  const originalSenses:SenseLine[] = []
  let allOriginalSensesMatched = true
  if (word.meaningZh) for (const part of word.meaningZh.split(/[；;,，]/)) {
    const meaning = part.replace(/^[a-z]+\.\s*/i, '').replace(/[（(].*?[）)]/g, '').trim()
    if (!/^[\u3400-\u9fff]{2,}$/.test(meaning)) { allOriginalSensesMatched = false; continue }
    const matches = [...new Set(ecdictSenses.filter(sense => sense.meaning.includes(meaning)).map(sense => sense.pos))]
    if (matches.length !== 1) { allOriginalSensesMatched = false; continue }
    if (!atlasSenses.some(sense => sense.meaning.includes(meaning))) originalSenses.push({pos:matches[0], meaning})
  }
  let senses = groupSenses(atlasSenses.length ? [...atlasSenses, ...originalSenses] : allOriginalSensesMatched && originalSenses.length ? originalSenses : ecdictSenses)
  if (!senses.length && specialNouns.has(word.word.trim().toLowerCase()) && word.meaningZh) senses = [{pos:'n.', meaning:word.meaningZh}]
  if (!senses.length && word.meaningZh) senses = [{pos:'', meaning:word.meaningZh}]
  const ecdictDefinitions = typeof ecdict?.definition === 'string' ? ecdict.definition.replaceAll('\\n', '\n').split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 3) : []
  let definitions:DefinitionLine[]
  if (word.definitionEn) definitions = [{pos:'', en:word.definitionEn, zh:word.definitionZh || word.note || ''}]
  else if (atlas?.senses.some(sense => sense.en)) definitions = atlas.senses.filter(sense => sense.en).map(sense => ({pos:sense.pos, en:sense.en, zh:sense.zh}))
  else definitions = ecdictDefinitions.map(line => { const match = line.match(/^([a-z]+\.)\s*(.*)$/i); return {pos:match?.[1] || '', en:match?.[2] || line, zh:''} })
  let usedWordnetDefinitions = false
  if (!definitions.length && Array.isArray(wordnetDefinitions?.definitions)) {
    definitions = wordnetDefinitions.definitions.slice(0, 3).filter((item:Entry) => typeof item?.en === 'string' && item.en).map((item:Entry) => ({pos:item.pos === 's' || item.pos === 'a' ? 'adj.' : item.pos === 'r' ? 'adv.' : typeof item.pos === 'string' ? item.pos + '.' : '', en:item.en as string, zh:''}))
    usedWordnetDefinitions = definitions.length > 0
  }
  let wiktionaryUrl:string | undefined
  if (!definitions.length && typeof wiktionary?.en === 'string' && typeof wiktionary?.pos === 'string' && typeof wiktionary?.sourceUrl === 'string' && wiktionary.sourceUrl.startsWith('https://en.wiktionary.org/wiki/')) {
    definitions = [{pos:wiktionary.pos, en:wiktionary.en, zh:''}]
    if (typeof wiktionary.meaningZh === 'string' && wiktionary.meaningZh) senses = [{pos:wiktionary.pos, meaning:wiktionary.meaningZh}]
    wiktionaryUrl = wiktionary.sourceUrl
  }
  const phrases: PhraseLine[] = []
  const addPhrase = (en:string, zh:string) => { if (en && !phrases.some(p => p.en.toLowerCase() === en.toLowerCase())) phrases.push({en, zh}) }
  word.phrases.forEach((phrase, i) => addPhrase(phrase, word.phraseTranslations[i] || ''))
  for (const phrase of atlas?.collocations || []) { const [en, ...zh] = phrase.split('｜'); addPhrase(en.trim(), zh.join('｜').trim()) }
  if (!phrases.length && typeof ownPhrase?.phrase === 'string') addPhrase(ownPhrase.phrase.trim(), '')
  const examples: ExampleLine[] = []
  if (word.exampleEn) examples.push({ en:word.exampleEn, zh:word.exampleZh || '', source:'course' })
  for (const example of atlas?.examples || []) if (!examples.some(x => x.en === example.en)) examples.push({ ...example, source:'atlas' })
  if (!examples.length && typeof tatoeba?.en === 'string' && typeof tatoeba?.zh === 'string' && typeof tatoeba.enId === 'number' && Number.isSafeInteger(tatoeba.enId) && tatoeba.enId > 0 && typeof tatoeba.zhId === 'number' && Number.isSafeInteger(tatoeba.zhId) && tatoeba.zhId > 0 && typeof tatoeba.enAuthor === 'string' && typeof tatoeba.zhAuthor === 'string' && typeof tatoeba.enLicense === 'string' && typeof tatoeba.zhLicense === 'string') examples.push({en:tatoeba.en, zh:tatoeba.zh, source:'tatoeba', enAuthor:tatoeba.enAuthor, zhAuthor:tatoeba.zhAuthor, enLicense:tatoeba.enLicense, zhLicense:tatoeba.zhLicense, enId:tatoeba.enId, zhId:tatoeba.zhId})
  if (!examples.length && typeof wordnet?.example === 'string' && wordnet.example) examples.push({en:wordnet.example, zh:'', source:'wordnet'})
  if (!examples.length && tatoebaEnglish?.approved === true && typeof tatoebaEnglish.en === 'string' && typeof tatoebaEnglish.enId === 'number' && Number.isSafeInteger(tatoebaEnglish.enId) && tatoebaEnglish.enId > 0 && typeof tatoebaEnglish.enAuthor === 'string' && typeof tatoebaEnglish.enLicense === 'string') examples.push({en:tatoebaEnglish.en, zh:'', source:'tatoeba', enAuthor:tatoebaEnglish.enAuthor, enLicense:tatoebaEnglish.enLicense, enId:tatoebaEnglish.enId})
  const sources:string[] = []
  if (atlas && (atlasSenses.length || atlas.collocations.length || atlas.examples.length)) sources.push('atlas')
  if (ecdict && (!atlasSenses.length || originalSenses.length || (!word.definitionEn && !atlas?.senses.some(s => s.en)))) sources.push('ecdict')
  if (usedWordnetDefinitions || (ecdictDefinitions.length && !word.definitionEn && !atlas?.senses.some(s => s.en)) || examples.some(example => example.source === 'wordnet')) sources.push('wordnet')
  if (examples.some(example => example.source === 'tatoeba')) sources.push('tatoeba')
  if (wiktionaryUrl) sources.push('wiktionary')
  return { senses, definitions, phrases:phrases.slice(0, 4), examples:examples.slice(0, 2), sources, wiktionaryUrl }
}
