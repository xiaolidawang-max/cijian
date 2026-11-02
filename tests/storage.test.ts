import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER_POSITION_PREFIX, FAVORITES_KEY, OPTIONS_KEY, POSITION_KEY, REVIEW_SESSION_KEY, StudyConflictError, createStudyStore, readChapterPositions, readFavorites, readReviewSession, readStoredReviews, readStudyOptions, savePosition, validStudyOptions } from '../src/studyStorage.ts'
import type { ExclusiveRunner, NewReviewSession, StudyOptions } from '../src/studyStorage.ts'
import { parseStudyBackup, restoreStudyBackup } from '../src/studyBackup.ts'
import { REVIEW_KEY } from '../src/studyReview.ts'

class MemoryStorage implements Storage {
  data = new Map<string, string>()
  failOnce: string | null = null
  get length() { return this.data.size }
  clear() { this.data.clear() }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  getItem(key: string) { return this.data.get(key) ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { if (key === this.failOnce) { this.failOnce = null; throw new Error('quota exceeded') }; this.data.set(key, value) }
}
function serialLock(): ExclusiveRunner {
  let tail: Promise<unknown> = Promise.resolve()
  return operation => { const task = tail.then(operation); tail = task.catch(() => {}); return task }
}
const sessionInput: NewReviewSession = { queue:['atmosphere','photosynthesis'], mode:'recall', scope:'all', filter:'mixed' }
const options = { chinese:true, auto:false, speed:1, largeText:false }
const backupBase = { format:'wordspace-study-backup', version:3, exportedAt:'2026-11-01T00:00:00Z', position:'photosynthesis', favorites:['photosynthesis'], options, reviews:{}, chapterPositions:{plants:'photosynthesis'}, reviewSession:null }

test('blocked browser storage does not crash rendering and writes reject asynchronously', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable:true, get:() => { throw new Error('blocked storage') } })
  try {
    assert.deepEqual(readFavorites(), [])
    assert.deepEqual({...readChapterPositions()}, {})
    assert.equal(readReviewSession(), null)
    assert.deepEqual(readStoredReviews(), {})
    assert.deepEqual(readStudyOptions(), options)
    await assert.rejects(savePosition('chapter','word'), /blocked storage/)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('independent tabs merge simultaneous favorite changes and removal against latest storage', async () => {
  const storage = new MemoryStorage(), lock = serialLock()
  const tabA = createStudyStore(storage, lock), tabB = createStudyStore(storage, lock)
  await Promise.all([tabA.toggleFavorite('photosynthesis'), tabB.toggleFavorite('respire')])
  assert.deepEqual(readFavorites(storage), ['photosynthesis','respire'])
  await Promise.all([tabA.toggleFavorite('photosynthesis'), tabB.toggleFavorite('ecology')])
  assert.deepEqual(readFavorites(storage), ['respire','ecology'])
})

test('legacy settings and backups remain valid without adding image size', async () => {
  const storage = new MemoryStorage(), store = createStudyStore(storage, serialLock())
  storage.setItem(OPTIONS_KEY, JSON.stringify(options))
  assert.equal(validStudyOptions(options), true)
  assert.deepEqual(readStudyOptions(storage), options)
  await store.updateOptions({ chinese:false })
  assert.deepEqual(readStudyOptions(storage), {...options,chinese:false})
  for (const version of [1,2,3]) {
    const backup = parseStudyBackup(JSON.stringify({...backupBase,version}))
    assert.deepEqual(backup.options, options)
    assert.equal(Object.hasOwn(backup.options, 'imageSize'), false)
  }
})

test('image size persists while independent option patches merge', async () => {
  const storage = new MemoryStorage(), lock = serialLock()
  const tabA = createStudyStore(storage, lock), tabB = createStudyStore(storage, lock)
  await Promise.all([tabA.updateOptions({imageSize:240}), tabB.updateOptions({chinese:false})])
  assert.deepEqual(readStudyOptions(storage), {...options,imageSize:240,chinese:false})
  await tabA.updateOptions({imageSize:360})
  await tabB.updateOptions({largeText:true,speed:0.8})
  assert.deepEqual(readStudyOptions(storage), {...options,imageSize:360,chinese:false,largeText:true,speed:0.8})
})

test('backup parse and restore preserve each supported image size', async () => {
  for (const imageSize of [240,300,360] as const) {
    const storage = new MemoryStorage(), lock = serialLock(), store = createStudyStore(storage, lock)
    await store.updateOptions({imageSize})
    const backup = parseStudyBackup(JSON.stringify({...backupBase,options:readStudyOptions(storage)}))
    assert.equal(backup.options.imageSize, imageSize)
    await store.updateOptions({imageSize:imageSize === 240 ? 360 : 240})
    await restoreStudyBackup(storage, backup, lock)
    assert.deepEqual(readStudyOptions(storage), {...options,imageSize})
  }
})

test('invalid image sizes reject without replacing stored settings', async () => {
  const storage = new MemoryStorage(), store = createStudyStore(storage, serialLock())
  await store.updateOptions({imageSize:300})
  const before = storage.getItem(OPTIONS_KEY)
  for (const imageSize of [0,299,480,null,'300',true,{},NaN,Infinity]) {
    assert.equal(validStudyOptions({...options,imageSize}), false)
    assert.throws(() => parseStudyBackup(JSON.stringify({...backupBase,options:{...options,imageSize}})), /学习设置无效/)
    await assert.rejects(store.updateOptions({imageSize} as Partial<StudyOptions>), /学习设置无效/)
    assert.equal(storage.getItem(OPTIONS_KEY), before)
  }
})

test('reviews from two tabs preserve both words and only one grade consumes a session step', async () => {
  const storage = new MemoryStorage(), lock = serialLock()
  const tabA = createStudyStore(storage, lock), tabB = createStudyStore(storage, lock)
  await Promise.all([tabA.saveReview('first', true, 1000), tabB.saveReview('second', false, 1000)])
  assert.deepEqual(Object.keys(readStoredReviews(storage)).sort(), ['first','second'])
  const session = await tabA.createReviewSession(sessionInput)
  const results = await Promise.allSettled([tabA.saveReview('atmosphere', true, 2000, {id:session.id,step:0}), tabB.saveReview('atmosphere', true, 2000, {id:session.id,step:0})])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult
  assert.ok(rejected.reason instanceof StudyConflictError)
  assert.equal(readStoredReviews(storage).atmosphere.stage, 1)
  assert.equal(readReviewSession(storage)?.step, 1)
})

test('failed session write rolls back the grade so a retry does not reschedule twice', async () => {
  const storage = new MemoryStorage(), store = createStudyStore(storage, serialLock())
  const session = await store.createReviewSession(sessionInput)
  storage.failOnce = REVIEW_SESSION_KEY
  await assert.rejects(store.saveReview('atmosphere', true, 1000, {id:session.id,step:0}), /quota/)
  assert.deepEqual(readStoredReviews(storage), {})
  assert.equal(readReviewSession(storage)?.step, 0)
  await store.saveReview('atmosphere', true, 1000, {id:session.id,step:0})
  assert.equal(readStoredReviews(storage).atmosphere.stage, 1)
})

test('chapter positions survive switches/reloads, including migration of the old global position', async () => {
  const storage = new MemoryStorage(), store = createStudyStore(storage, serialLock())
  storage.setItem(POSITION_KEY, 'plants-80')
  await store.savePosition('geography', 'atmosphere', {chapterId:'plants',wordId:'plants-80'})
  assert.deepEqual({...readChapterPositions(storage)}, {geography:'atmosphere',plants:'plants-80'})
  await store.savePosition('geography', 'glacier', {chapterId:'plants',wordId:'stale-old-position'})
  assert.equal(readChapterPositions(storage).plants, 'plants-80')
  assert.equal(storage.getItem(POSITION_KEY), 'glacier')
  const session = await store.createReviewSession(sessionInput)
  await store.saveReview('atmosphere', false, 2000, {id:session.id,step:0})
  assert.equal(readReviewSession(storage)?.step, 1)
  assert.equal(readReviewSession(storage)?.queue[1], 'photosynthesis')
})

test('stale tabs cannot replace or clear a newer review session', async () => {
  const storage = new MemoryStorage(), store = createStudyStore(storage, serialLock())
  const oldSession = await store.createReviewSession(sessionInput)
  const newSession = await store.createReviewSession({...sessionInput,mode:'spelling'}, oldSession.id)
  await assert.rejects(store.clearReviewSession(oldSession.id), StudyConflictError)
  await assert.rejects(store.createReviewSession(sessionInput, oldSession.id), StudyConflictError)
  assert.equal(readReviewSession(storage)?.id, newSession.id)
})

test('corrupted stored records are not silently erased by a new write', async () => {
  const storage = new MemoryStorage(), store = createStudyStore(storage, serialLock())
  storage.setItem(FAVORITES_KEY, 'broken')
  await assert.rejects(store.toggleFavorite('word'), /记录格式异常/)
  assert.equal(storage.getItem(FAVORITES_KEY), 'broken')
  storage.setItem(REVIEW_KEY, '{"bad":true}')
  await assert.rejects(store.saveReview('word', true, 1000), /记录格式异常/)
  assert.equal(storage.getItem(REVIEW_KEY), '{"bad":true}')
})

test('v3 backup replaces chapter bookmarks and session while invalidating stale grading', async () => {
  const storage = new MemoryStorage(), lock = serialLock(), store = createStudyStore(storage, lock)
  await store.savePosition('geography', 'atmosphere')
  const session = await store.createReviewSession(sessionInput)
  const backup = parseStudyBackup(JSON.stringify({...backupBase, reviewSession:session}))
  await restoreStudyBackup(storage, backup, lock)
  assert.deepEqual({...readChapterPositions(storage)}, {plants:'photosynthesis'})
  assert.equal(storage.getItem(CHAPTER_POSITION_PREFIX + 'geography'), null)
  assert.equal(readReviewSession(storage)?.step, 0)
  assert.notEqual(readReviewSession(storage)?.id, session.id)
  await assert.rejects(store.saveReview('atmosphere', true, 2000, {id:session.id,step:0}), StudyConflictError)
})

test('v1/v2 compatibility; old snapshots do not resurrect newer chapter/session progress', async () => {
  const v1 = parseStudyBackup(JSON.stringify({...backupBase,version:1}))
  assert.equal(v1.reviews, undefined)
  const v2 = parseStudyBackup(JSON.stringify({...backupBase,version:2}))
  assert.deepEqual(v2.reviews, {})
  const storage = new MemoryStorage(), lock = serialLock(), store = createStudyStore(storage, lock)
  await store.savePosition('geography','old-word')
  await store.saveReview('old-word', true, 1000)
  await store.createReviewSession(sessionInput)
  await restoreStudyBackup(storage, v1, lock)
  assert.ok(readStoredReviews(storage)['old-word'])
  assert.deepEqual({...readChapterPositions(storage)}, {})
  assert.equal(readReviewSession(storage), null)
  assert.throws(() => parseStudyBackup(JSON.stringify({...backupBase,chapterPositions:{plants:3}})), /章节进度/)
  assert.throws(() => parseStudyBackup(JSON.stringify({...backupBase,reviewSession:{queue:['bad']}})), /章节进度/)
})

test('backup failure rolls back settings, position, favorites, reviews and chapter keys', async () => {
  const storage = new MemoryStorage(), lock = serialLock(), store = createStudyStore(storage, lock)
  await store.savePosition('geography','atmosphere')
  await store.toggleFavorite('old')
  await store.updateOptions({...options,speed:0.8})
  await store.saveReview('old', true, 1000)
  const before = [...storage.data]
  storage.failOnce = REVIEW_SESSION_KEY
  // Include a session so restore attempts setItem and exercises quota rollback.
  const session = { ...sessionInput,version:1,id:'snapshot-session',step:0,updatedAt:1000 }
  await assert.rejects(restoreStudyBackup(storage, parseStudyBackup(JSON.stringify({...backupBase,reviewSession:session})), lock), /quota/)
  assert.deepEqual(Object.fromEntries(storage.data), Object.fromEntries(before))
  assert.equal(storage.getItem(OPTIONS_KEY), JSON.stringify({...options,speed:0.8}))
})
