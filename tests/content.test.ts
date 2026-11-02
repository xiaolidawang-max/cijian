import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildStudyContent, conciseSenses, normalizePartOfSpeech, parseEcdictSenses } from '../src/studyContent.ts'
import type { CourseWord } from '../src/workbench.ts'

const read = (name:string) => JSON.parse(readFileSync(new URL(`../public/${name}.json`, import.meta.url), 'utf8'))
const words:CourseWord[] = read('course').course.words
const refs = ['word-atlas-reference', 'ecdict-reference', 'course-phrases', 'wordnet-examples', 'tatoeba-examples', 'wordnet-definitions', 'wiktionary-definitions', 'tatoeba-english-examples'].map(name => read(`uploads/${name}`))
const render = (word:CourseWord) => buildStudyContent(word, refs[0], refs[1], refs[2], refs[3], refs[4], refs[5], refs[6], refs[7])
const find = (text:string) => {
  const word = words.find(word => word.word === text)
  assert.ok(word, `Course word ${text} must exist`)
  return word
}
const fixture = (patch:Partial<CourseWord> = {}):CourseWord => ({...words[0], id:'test-only', word:'fixture', meaningZh:'核心含义', definitionEn:'', exampleEn:'', phrases:[], phraseTranslations:[], ...patch})
const dictionary = (word:CourseWord, entry:Record<string, unknown>) => ({version:1, entries:{[word.id]:{word:word.word, ...entry}}})

test('standard POS labels group transitive/intransitive verbs and WordNet adjective codes', () => {
  assert.deepEqual(['n', 'vt.', 'vi.', 'a', 's.', 'r', 'adj.', 'adv.'].map(normalizePartOfSpeech), ['n.', 'v.', 'v.', 'adj.', 'adj.', 'adv.', 'adj.', 'adv.'])
  assert.deepEqual(conciseSenses([
    {pos:'vt.', meaning:'种植；栽培；播种'}, {pos:'vi.', meaning:'生长'},
    {pos:'s.', meaning:'多年生的；长期的；持久的'},
  ]), [{pos:'v.', meaning:'种植；栽培'}, {pos:'adj.', meaning:'多年生的；长期的'}])
  assert.deepEqual(parseEcdictSenses('s. 长期的\\nr. 定期地'), [{pos:'adj.', meaning:'长期的'}, {pos:'adv.', meaning:'定期地'}])
})

test('editorial notes and dictionary redirects cannot become the core Chinese meaning', () => {
  assert.deepEqual(conciseSenses([{pos:'n.', meaning:'木炭（过去式 charcoaled；过去分词 charcoaled）'}, {pos:'n.', meaning:'<主英> = charcoal'}]), [{pos:'n.', meaning:'木炭'}])
  assert.deepEqual(conciseSenses([{pos:'adj.', meaning:'a.可怕的；【口语】糟糕的'}]), [{pos:'adj.', meaning:'可怕的；糟糕的'}])
  const word = fixture({meaningZh:'杂交；配种'})
  const result = buildStudyContent(word, null, dictionary(word, {translation:'n. <主英> = hybridization'}), null, null)
  assert.deepEqual(result.senses, [{pos:'n.', meaning:'杂交；配种'}])
  assert.deepEqual(render(find('hybridisation')).senses, [{pos:'n.', meaning:'杂交；配种'}])
  assert.deepEqual(render(find('hybridise')).senses, [{pos:'v.', meaning:'杂交'}])
})

test('explicit course POS labels are retained without guessing an ambiguous POS', () => {
  const explicit = fixture({meaningZh:'n.收获；v. 收割'})
  assert.deepEqual(buildStudyContent(explicit, null, null, null, null).senses, [{pos:'n.', meaning:'收获'}, {pos:'v.', meaning:'收割'}])
  assert.deepEqual(buildStudyContent(fixture({meaningZh:'某个含义'}), null, null, null, null).senses, [{pos:'', meaning:'某个含义'}])
})

test('raw English dictionary POS prefixes are removed without stripping a capitalized article', () => {
  const word = fixture()
  for (const [raw, pos, en] of [
    ['v breed animals or plants', 'v.', 'breed animals or plants'],
    ['a suitable for use', 'adj.', 'suitable for use'],
    ['s lasting for years', 'adj.', 'lasting for years'],
    ['r at regular intervals', 'adv.', 'at regular intervals'],
    ['n. a water store', 'n.', 'a water store'],
    ['A group of similar things.', '', 'A group of similar things.'],
  ]) {
    const result = buildStudyContent(word, null, dictionary(word, {definition:raw}), null, null)
    assert.deepEqual(result.definitions[0], {pos, en, zh:''})
  }
})

test('core meanings preserve the useful noun and verb distinction', () => {
  assert.deepEqual(render(find('harvest')).senses, [{pos:'n.', meaning:'收成；收获'}, {pos:'v.', meaning:'收割；采收'}])
  assert.deepEqual(render(find('yield')).senses, [{pos:'n.', meaning:'产量；收益'}, {pos:'v.', meaning:'产生；屈服'}])
  assert.deepEqual(render(find('mineral')).senses, [{pos:'n.', meaning:'矿物'}, {pos:'adj.', meaning:'矿物的；矿产的'}])
  assert.ok(render(find('perennial')).senses.some(sense => sense.meaning.includes('多年生的')))
  assert.ok(render(find('wholesale')).senses.some(sense => sense.pos === 'v.' && sense.meaning === '批发'))
  assert.deepEqual(render(find('browser')).senses, [{pos:'n.', meaning:'浏览器'}])
  assert.deepEqual(render(find('cycling')).senses, [{pos:'n.', meaning:'骑自行车'}])
  assert.deepEqual(render(find('laptop')).senses, [{pos:'n.', meaning:'笔记本电脑'}])
  assert.deepEqual(render(find('quantum')).senses, [{pos:'n.', meaning:'量子'}])
})

test('a single POS does not force unrelated old meanings ahead of a curated core definition', () => {
  const word = fixture({meaningZh:'罕见旧义；冗长的描述'})
  const atlas = dictionary(word, {senses:[{pos:'n.', zh:'核心含义', en:'The main meaning.'}]})
  assert.deepEqual(buildStudyContent(word, atlas, null, null, null).senses, [{pos:'n.', meaning:'核心含义'}])
})

test('known wrong translations and mismatched examples are replaced with attributed editorial text', () => {
  for (const text of ['hybridise', 'reservoir', 'ecliptic', 'courtship', 'plural']) {
    const content = render(find(text))
    assert.equal(content.examples[0].source, 'editorial')
    assert.ok(content.examples[0].zh)
    assert.ok(content.sources.includes('editorial'))
    assert.equal(content.examples[0].enAuthor, undefined)
  }
  assert.match(render(find('reservoir')).examples[0].en, /drinking water/)
  assert.match(render(find('ecliptic')).examples[0].zh, /黄道/)
  assert.doesNotMatch(render(find('courtship')).examples[0].en, /its was/)
  assert.doesNotMatch(render(find('plural')).examples[0].zh, /虱子们/)
})

test('course-authored examples and definitions take precedence over reference corrections', () => {
  const word = {...find('reservoir'), exampleEn:'Our reservoir is full.', exampleZh:'我们的水库满了。', definitionEn:'A locally edited definition.'}
  const content = render(word)
  assert.equal(content.examples[0].en, word.exampleEn)
  assert.equal(content.examples[0].source, 'course')
  assert.equal(content.definitions[0].en, word.definitionEn)
})

test('translations preserve their English source and do not mutate the reference data', () => {
  const before = JSON.stringify(refs)
  const translated = words.flatMap(word => render(word).examples).find(example => example.translationSource === 'editorial')
  assert.ok(translated)
  assert.notEqual(translated.source, 'editorial')
  assert.ok(translated.zh)
  assert.equal(JSON.stringify(refs), before)
})

test('all course words have concise POS groups, with no technical POS codes or empty core meanings', () => {
  assert.equal(words.length, 3623)
  for (const word of words) {
    const content = render(word)
    assert.ok(content.senses.length > 0 && content.senses.length <= 3, word.word)
    assert.equal(new Set(content.senses.map(sense => sense.pos)).size, content.senses.length, word.word)
    for (const sense of content.senses) {
      assert.ok(sense.pos && sense.meaning, word.word)
      assert.ok(sense.meaning.split('；').length <= 2, word.word)
      assert.ok(!['a.', 's.', 'r.', 'vt.', 'vi.'].includes(sense.pos), word.word)
      assert.doesNotMatch(sense.meaning, /^=|<主英>|过去分词|过去式/, word.word)
    }
    for (const definition of content.definitions) assert.ok(!['a.', 's.', 'r.'].includes(definition.pos), word.word)
  }
})
