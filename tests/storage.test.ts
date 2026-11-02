import test from 'node:test'
import assert from 'node:assert/strict'
import { CHAPTER_POSITION_PREFIX, FAVORITES_KEY, OPTIONS_KEY, POSITION_KEY, REVIEW_SESSION_KEY, StudyConflictError, createStudyStore, readChapterPositions, readFavorites, readReviewSession, readStoredReviews, readStudyOptions, savePosition, validStudyOptions, withStudyLock } from '../src/studyStorage.ts'
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

function replaceGlobal(name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, { configurable:true, value })
  return () => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name) }
}

// Controlled IDB events exercise lock acquisition/failure paths. Browser-level
// transaction scheduling and cross-tab exclusion are verified separately.
function databaseHarness() {
  type Handler = (() => void) | null
  const transactions: ReturnType<typeof makeTransaction>[] = []
  const requests: ReturnType<typeof makeRequest>[] = []
  let closed = 0
  const makeTransaction = () => {
    const gate = { onsuccess:null as Handler }
    const transaction = {
      oncomplete:null as Handler, onabort:null as Handler,
      objectStore:(_name: string) => ({ get:(_key: string) => gate }),
      abort:() => queueMicrotask(() => transaction.onabort?.()),
      gate,
    }
    return transaction
  }
  const database = {
    onversionchange:null as Handler,
    createObjectStore:(_name: string) => {},
    close:() => { closed++ },
    transaction:(_name: string, mode: string) => {
      assert.equal(mode, 'readwrite')
      const transaction = makeTransaction()
      transactions.push(transaction)
      return transaction
    },
  }
  const makeRequest = () => ({ result:database, onerror:null as Handler, onblocked:null as Handler, onupgradeneeded:null as Handler, onsuccess:null as Handler })
  const factory = { open:(_name: string, version: number) => { assert.equal(version, 1); const request = makeRequest(); requests.push(request); return request } }
  return { factory, requests, transactions, get closed() { return closed } }
}

test('HTTP fallback waits for the IDB request event before reading or writing existing records', async () => {
  const harness = databaseHarness(), storage = new MemoryStorage()
  storage.setItem(FAVORITES_KEY, JSON.stringify(['old']))
  const restoreNavigator = replaceGlobal('navigator', {}), restoreIDB = replaceGlobal('indexedDB', harness.factory)
  try {
    const store = createStudyStore(storage)
    const pending = store.toggleFavorite('new')
    assert.deepEqual(readFavorites(storage), ['old'])
    harness.requests[0].onsuccess?.()
    assert.deepEqual(readFavorites(storage), ['old'])
    // Simulate another tab completing its transaction before our gate is granted.
    storage.setItem(FAVORITES_KEY, JSON.stringify(['old','other-tab']))
    harness.transactions[0].gate.onsuccess?.()
    harness.transactions[0].oncomplete?.()
    assert.deepEqual(await pending, ['old','other-tab','new'])
    assert.equal(harness.closed, 1)
  } finally { restoreIDB(); restoreNavigator() }
})

test('HTTP fallback rejects unavailable, blocked and aborted locks without executing the callback', async () => {
  const restoreNavigator = replaceGlobal('navigator', {})
  let called = 0
  try {
    for (const factory of [undefined, { open:() => { throw new Error('storage denied') } }]) {
      const restoreIDB = replaceGlobal('indexedDB', factory)
      try { await assert.rejects(withStudyLock(() => ++called), /安全保存/) } finally { restoreIDB() }
    }
    for (const event of ['onerror','onblocked'] as const) {
      const harness = databaseHarness(), restoreIDB = replaceGlobal('indexedDB', harness.factory)
      try {
        const pending = withStudyLock(() => ++called)
        const rejected = assert.rejects(pending, /安全保存/)
        harness.requests[0][event]?.()
        // A blocked open can succeed later; that must never run a stale operation.
        harness.requests[0].onsuccess?.()
        await rejected
        assert.equal(harness.transactions.length, 0)
        assert.equal(harness.closed, 1)
      } finally { restoreIDB() }
    }
    const harness = databaseHarness(), restoreIDB = replaceGlobal('indexedDB', harness.factory)
    try {
      const pending = withStudyLock(() => ++called), rejected = assert.rejects(pending, /安全保存/)
      harness.requests[0].onsuccess?.()
      harness.transactions[0].onabort?.()
      await rejected
    } finally { restoreIDB() }
    assert.equal(called, 0)
  } finally { restoreNavigator() }
})

test('HTTP backup failure keeps the existing localStorage rollback and releases the transaction', async () => {
  const harness = databaseHarness(), storage = new MemoryStorage()
  storage.setItem(POSITION_KEY, 'old-word')
  storage.setItem(FAVORITES_KEY, JSON.stringify(['old']))
  const before = Object.fromEntries(storage.data)
  storage.failOnce = OPTIONS_KEY
  const restoreNavigator = replaceGlobal('navigator', {}), restoreIDB = replaceGlobal('indexedDB', harness.factory)
  try {
    const pending = restoreStudyBackup(storage, parseStudyBackup(JSON.stringify(backupBase)))
    const rejected = assert.rejects(pending, /quota/)
    harness.requests[0].onsuccess?.()
    harness.transactions[0].gate.onsuccess?.()
    await rejected
    assert.deepEqual(Object.fromEntries(storage.data), before)
    assert.equal(harness.closed, 1)
  } finally { restoreIDB(); restoreNavigator() }
})

test('a lock-only IDB abort after a successful write does not report that completed write as failed', async () => {
  const harness = databaseHarness(), storage = new MemoryStorage()
  const restoreNavigator = replaceGlobal('navigator', {}), restoreIDB = replaceGlobal('indexedDB', harness.factory)
  try {
    const pending = createStudyStore(storage).toggleFavorite('word')
    harness.requests[0].onsuccess?.()
    harness.transactions[0].gate.onsuccess?.()
    harness.transactions[0].onabort?.()
    assert.deepEqual(await pending, ['word'])
    assert.deepEqual(readFavorites(storage), ['word'])
  } finally { restoreIDB(); restoreNavigator() }
})

test('both lock backends reject asynchronous callbacks and Promise results', async () => {
  for (const native of [false,true]) {
    const harness = databaseHarness()
    const restoreNavigator = replaceGlobal('navigator', native ? { locks:{ request:async (_name: string, _options: unknown, operation: () => unknown) => operation() } } : {})
    const restoreIDB = replaceGlobal('indexedDB', harness.factory)
    try {
      let called = false
      // Deliberately bypass the synchronous callback type to verify runtime defense.
      const asyncOperation = (async () => { called = true }) as unknown as () => never
      await assert.rejects(withStudyLock(asyncOperation), /不能使用异步回调/)
      assert.equal(called, false)
      assert.equal(harness.requests.length, 0)
      const promiseOperation = (() => Promise.resolve(1)) as unknown as () => never
      const pending = withStudyLock(promiseOperation), rejected = assert.rejects(pending, /不能使用异步回调/)
      if (!native) {
        harness.requests[0].onsuccess?.()
        harness.transactions[0].gate.onsuccess?.()
      }
      await rejected
    } finally { restoreIDB(); restoreNavigator() }
  }
})

test('native Web Locks errors reject without bypassing the lock through IndexedDB', async () => {
  const harness = databaseHarness()
  const restoreNavigator = replaceGlobal('navigator', { locks:{ request:async () => { throw new Error('lock denied') } } })
  const restoreIDB = replaceGlobal('indexedDB', harness.factory)
  try {
    await assert.rejects(withStudyLock(() => assert.fail('must not run')), /lock denied/)
    assert.equal(harness.requests.length, 0)
  } finally { restoreIDB(); restoreNavigator() }
})

test('legacy session creation and backup restore work without secure-context randomUUID', async () => {
  const secureRandom = globalThis.crypto.getRandomValues.bind(globalThis.crypto)
  const restoreCrypto = replaceGlobal('crypto', { getRandomValues:secureRandom })
  try {
    const storage = new MemoryStorage(), lock = serialLock(), store = createStudyStore(storage, lock)
    const session = await store.createReviewSession(sessionInput)
    assert.match(session.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const restored = await restoreStudyBackup(storage, parseStudyBackup(JSON.stringify({...backupBase,reviewSession:session})), lock)
    assert.notEqual(restored?.id, session.id)
    assert.match(restored!.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  } finally { restoreCrypto() }
})

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
