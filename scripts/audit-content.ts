// Structural coverage, not a claim that every dictionary sense was manually reviewed.
// Run: node --experimental-strip-types scripts/audit-content.ts
import { readFileSync } from 'node:fs'
import { buildStudyContent } from '../src/studyContent.ts'
import type { CourseWord } from '../src/workbench.ts'

const read = (name:string) => JSON.parse(readFileSync(new URL(`../public/${name}.json`, import.meta.url), 'utf8'))
const words:CourseWord[] = read('course').course.words
const refs = ['word-atlas-reference', 'ecdict-reference', 'course-phrases', 'wordnet-examples', 'tatoeba-examples', 'wordnet-definitions', 'wiktionary-definitions', 'tatoeba-english-examples'].map(name => read(`uploads/${name}`))
const rows = words.map(word => ({word:word.word, ...buildStudyContent(word, refs[0], refs[1], refs[2], refs[3], refs[4], refs[5], refs[6], refs[7])}))
console.log(JSON.stringify({
  words:rows.length,
  missingCoreMeaning:rows.filter(row => !row.senses.length).length,
  missingPartOfSpeech:rows.filter(row => row.senses.some(sense => !sense.pos)).length,
  missingExamples:rows.filter(row => !row.examples.length).length,
  wordsWithUntranslatedExamples:rows.filter(row => row.examples.some(example => !example.zh)).length,
  wordsWithUntranslatedPhrases:rows.filter(row => row.phrases.some(phrase => !phrase.zh)).length,
  technicalPartOfSpeech:rows.filter(row => [...row.senses, ...row.definitions].some(sense => ['a.', 's.', 'r.', 'vt.', 'vi.'].includes(sense.pos))).length,
  longestCoreMeanings:rows.flatMap(row => row.senses.map(sense => ({word:row.word, ...sense}))).sort((a, b) => b.meaning.length - a.meaning.length).slice(0, 8),
}, null, 2))
