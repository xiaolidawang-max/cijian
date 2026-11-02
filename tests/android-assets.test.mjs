import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { localAssetPath, prepareAndroidAssets } from '../scripts/prepare-android-assets.mjs'

async function fixture(t) {
  const tempRoot = path.resolve(os.tmpdir())
  const root = await mkdtemp(path.join(tempRoot, 'cijian-android-assets-test-'))
  t.after(async () => {
    if (path.dirname(path.resolve(root)) !== tempRoot || !path.basename(root).startsWith('cijian-android-assets-test-')) throw new Error('Unsafe test cleanup')
    await rm(root, { recursive: true, force: true })
  })
  const put = async (relative, data) => { const file = path.join(root, relative); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, data) }
  await put('dist-android/index.html', '<main>built app</main>')
  await put('dist-android/assets/app.js', 'built bundle')
  await put('src/App.tsx', "const files: [keyof StudyResources, string][] = [\n ['frames', 'frames.json'],\n ]")
  await put('README.md', '# 词间\n\n## 内容来源\nTest attribution.\n')
  await put('public/uploads/frames.json', '{}')
  await put('public/uploads/ECDICT_LICENSE.txt', 'ECDICT license')
  await put('public/uploads/WORDNET_LICENSE.txt', 'WordNet license')
  await put('public/app-icon.svg', '<svg/>')
  await put('public/favicon.svg', '<svg/>')
  await put('public/manifest.webmanifest', JSON.stringify({ icons: [{ src: './app-icon.svg' }] }))
  await put('public/uploads/preview.webp', 'preview image bytes')
  await put('public/uploads/zoom.webp', 'larger image bytes')
  await put('public/uploads/unused.webp', 'unused image bytes')
  await put('public/audio/example.mp3', 'audio bytes')
  const document = { course: { chapters: [{ id: 'chapter' }], words: [{ id: 'one', chapter: 'chapter', word: 'example', meaningZh: '示例', imageUrl: '/uploads/preview.webp', imageZoomUrl: '/uploads/zoom.webp', audioUrl: '/audio/example.mp3?v=1' }] } }
  await put('public/course.json', JSON.stringify(document))
  return { root, put, document }
}

test('Android package is complete, compact, and does not change source course or Vite output', async t => {
  const { root, document } = await fixture(t)
  const result = await prepareAndroidAssets(root)
  const packaged = JSON.parse(await readFile(path.join(root, 'dist-android/course.json'), 'utf8'))
  assert.equal(packaged.course.words[0].imageZoomUrl, '/uploads/preview.webp')
  assert.equal(packaged.course.words[0].meaningZh, '示例')
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'public/course.json'), 'utf8')), document)
  assert.equal(await readFile(path.join(root, 'dist-android/assets/app.js'), 'utf8'), 'built bundle')
  assert.equal(await readFile(path.join(root, 'dist-android/index.html'), 'utf8'), '<main>built app</main>')
  assert.ok(!(await readdir(path.join(root, 'dist-android/uploads'))).includes('zoom.webp'))
  assert.ok(!(await readdir(path.join(root, 'dist-android/uploads'))).includes('unused.webp'))
  assert.equal(result.wordCount, 1)
  assert.equal(result.imageFiles, 1)
  assert.equal(result.audioFiles, 1)
  assert.equal(result.packageFiles, result.resourceFiles + 3) // Vite files + generated manifest.
  assert.ok(result.packageBytes > result.resourceBytes)
  assert.deepEqual(await prepareAndroidAssets(root), result)
})

test('missing or unsafe dependencies fail before copying public files', async t => {
  const { root, put, document } = await fixture(t)
  for (const url of ['/uploads/missing.webp', '/uploads/../../private.txt', '//host/image.webp', 'https://host/image.webp', '/uploads/%2e%2e/%2e%2e/private.txt']) {
    document.course.words[0].imageUrl = url
    await put('public/course.json', JSON.stringify(document))
    await assert.rejects(prepareAndroidAssets(root))
    assert.deepEqual((await readdir(path.join(root, 'dist-android'))).sort(), ['assets', 'index.html'])
  }
})

test('a new snapshot removes only prior generated resources and preserves build files', async t => {
  const { root, put, document } = await fixture(t)
  await prepareAndroidAssets(root)
  await put('public/uploads/new-preview.webp', 'new preview')
  document.course.words[0].imageUrl = '/uploads/new-preview.webp'
  await put('public/course.json', JSON.stringify(document))
  await prepareAndroidAssets(root)
  assert.ok(!(await readdir(path.join(root, 'dist-android/uploads'))).includes('preview.webp'))
  assert.equal(await readFile(path.join(root, 'public/uploads/preview.webp'), 'utf8'), 'preview image bytes')
  assert.equal(await readFile(path.join(root, 'dist-android/assets/app.js'), 'utf8'), 'built bundle')
})

test('the previous manifest cannot instruct the script to delete a build file', async t => {
  const { root, put } = await fixture(t)
  await put('dist-android/android-assets-manifest.json', JSON.stringify({ producer: 'cijian-android-assets-v1', files: [{ path: 'assets/app.js' }] }))
  await assert.rejects(prepareAndroidAssets(root), /not owned/)
  assert.equal(await readFile(path.join(root, 'dist-android/assets/app.js'), 'utf8'), 'built bundle')
})

test('an output directory junction cannot create files outside the package', async t => {
  const { root, put, document } = await fixture(t)
  document.course.words[0].imageUrl = '/uploads/nested/preview.webp'
  await put('public/course.json', JSON.stringify(document))
  await put('public/uploads/nested/preview.webp', 'preview bytes')
  await put('unrelated/keep.txt', 'untouched')
  await symlink(path.join(root, 'unrelated'), path.join(root, 'dist-android/uploads'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(prepareAndroidAssets(root), /directory is a link/)
  assert.deepEqual(await readdir(path.join(root, 'unrelated')), ['keep.txt'])
})

test('local URL normalization allows cache queries but rejects traversal and filesystem paths', () => {
  assert.equal(localAssetPath('/audio/one.mp3?v=1'), 'audio/one.mp3')
  assert.equal(localAssetPath('./app-icon.svg'), 'app-icon.svg')
  assert.equal(localAssetPath('/uploads/two%20words.webp'), 'uploads/two words.webp')
  for (const input of ['../secret', '/uploads/../secret', 'C:/secret', '/uploads/%5csecret', '/%00secret', '//example.com/file', '/uploads/%GG', '/uploads/CON.webp', '/uploads/file.', '/uploads/%252e%252e/file']) assert.throws(() => localAssetPath(input))
})

test('a three-chapter package preserves all selected words and removes other chapter assets only from output', async t => {
  const { root, put, document } = await fixture(t)
  document.course.chapters = ['first', 'second', 'third', 'fourth'].map(id => ({ id, name: id }))
  const original = document.course.words[0]
  document.course.words = ['first', 'first', 'second', 'third', 'fourth'].map((chapter, index) => ({
    ...original, id: `word-${index}`, chapter, word: `example-${index}`, imageUrl: `/uploads/preview-${index}.webp`, audioUrl: index === 4 ? '/audio/fourth.mp3' : original.audioUrl,
  }))
  for (let index = 0; index < 5; index++) await put(`public/uploads/preview-${index}.webp`, `preview ${index}`)
  await put('public/audio/fourth.mp3', 'fourth chapter audio')
  await put('public/course.json', JSON.stringify(document))
  const all = await prepareAndroidAssets(root)
  assert.equal(all.chapterCount, 4)
  assert.equal(all.wordCount, 5)
  const limited = await prepareAndroidAssets(root, { chapters: 3 })
  const packaged = JSON.parse(await readFile(path.join(root, 'dist-android/course.json'), 'utf8'))
  assert.deepEqual(packaged.course.chapters, document.course.chapters.slice(0, 3))
  assert.deepEqual(packaged.course.words, document.course.words.slice(0, 4).map(word => ({ ...word, imageZoomUrl: word.imageUrl })))
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'public/course.json'), 'utf8')), document)
  assert.equal(limited.chapterLimit, 3)
  assert.equal(limited.chapterCount, 3)
  assert.equal(limited.wordCount, 4)
  assert.equal(limited.imageFiles, 4)
  assert.equal(limited.audioFiles, 1)
  assert.equal(limited.resourceFiles, all.resourceFiles - 2)
  assert.ok(!(await readdir(path.join(root, 'dist-android/uploads'))).includes('preview-4.webp'))
  assert.ok(!(await readdir(path.join(root, 'dist-android/audio'))).includes('fourth.mp3'))
  assert.equal(await readFile(path.join(root, 'public/uploads/preview-4.webp'), 'utf8'), 'preview 4')
  assert.equal(await readFile(path.join(root, 'public/audio/fourth.mp3'), 'utf8'), 'fourth chapter audio')
  assert.deepEqual(await prepareAndroidAssets(root, { chapters: 3 }), limited)
})

test('invalid chapter limits fail before writing package resources', async t => {
  const { root } = await fixture(t)
  for (const chapters of [0, -1, 1.5, 2, '1', NaN]) {
    await assert.rejects(prepareAndroidAssets(root, { chapters }), /Chapter limit/)
    assert.deepEqual((await readdir(path.join(root, 'dist-android'))).sort(), ['assets', 'index.html'])
  }
})
