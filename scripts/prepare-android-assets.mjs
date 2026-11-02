import { copyFile, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = 'android-assets-manifest.json'
const PRODUCER = 'cijian-android-assets-v1'
const LICENSES = ['uploads/ECDICT_LICENSE.txt', 'uploads/WORDNET_LICENSE.txt']

/** Accept only files below public/, never a URL or a filesystem escape. */
export function localAssetPath(url) {
  if (typeof url !== 'string' || !url || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('//')) {
    throw new Error(`Expected a local asset URL: ${String(url)}`)
  }
  let value
  try { value = decodeURIComponent(url.split(/[?#]/, 1)[0]) } catch { throw new Error(`Invalid URL encoding: ${url}`) }
  if (value.startsWith('./')) value = value.slice(2)
  else if (value.startsWith('/')) value = value.slice(1)
  const parts = value.split('/')
  if (!value || /[\\:%<>"|*\x00-\x1f]/.test(value) || parts.some(part => !part || part === '.' || part === '..' || /[ .]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error(`Unsafe asset path: ${url}`)
  }
  return value
}

function within(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
}

const samePath = (left, right) => process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right

async function safeFile(root, relative) {
  const absolute = path.resolve(root, relative)
  if (!within(root, absolute)) throw new Error(`Path escaped its root: ${relative}`)
  const resolved = await realpath(absolute)
  if (!within(root, resolved) || !samePath(absolute, resolved) || !(await stat(resolved)).isFile()) throw new Error(`Asset is not a local regular file: ${relative}`)
  return resolved
}

async function safeDestination(root, relative) {
  const absolute = path.resolve(root, localAssetPath(relative))
  if (!within(root, absolute)) throw new Error(`Output escaped its root: ${relative}`)
  let parent = root
  for (const part of path.relative(root, path.dirname(absolute)).split(path.sep).filter(Boolean)) {
    parent = path.join(parent, part)
    try {
      if (!samePath(parent, await realpath(parent))) throw new Error(`Output directory is a link: ${relative}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      // The preceding parent was verified before creating this single directory.
      await mkdir(parent)
    }
  }
  try {
    const resolved = await realpath(absolute)
    if (!within(root, resolved) || !samePath(absolute, resolved)) throw new Error(`Output file is a link: ${relative}`)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
  return absolute
}

function owned(relative) {
  return /^(?:uploads|audio)\//.test(relative) || ['course.json', 'manifest.webmanifest', 'favicon.svg', 'app-icon.svg', 'SOURCE_NOTICES.txt'].includes(relative)
}

export async function prepareAndroidAssets(project = PROJECT, { chapters: chapterLimit } = {}) {
  const projectRoot = await realpath(project)
  const publicRoot = await realpath(path.join(projectRoot, 'public'))
  const output = await realpath(path.join(projectRoot, 'dist-android'))
  if (!samePath(publicRoot, path.join(projectRoot, 'public')) || !samePath(output, path.join(projectRoot, 'dist-android'))) throw new Error('Invalid Android build directories')
  await safeFile(output, 'index.html') // Vite must have built the app first.
  const originalCourse = await readFile(await safeFile(publicRoot, 'course.json'), 'utf8')
  const packed = JSON.parse(originalCourse)
  let words = packed.course?.words
  if (!Array.isArray(words) || !words.length || !Array.isArray(packed.course?.chapters)) throw new Error('Invalid course.json')
  if (chapterLimit !== undefined) {
    if (!Number.isInteger(chapterLimit) || chapterLimit < 1 || chapterLimit > packed.course.chapters.length) throw new Error('Chapter limit must be a positive integer within the course chapter count')
    // Filter only the package copy, retaining the source chapter/word ordering.
    packed.course.chapters = packed.course.chapters.slice(0, chapterLimit)
    const chapterIds = new Set(packed.course.chapters.map(chapter => chapter.id))
    words = packed.course.words = words.filter(word => chapterIds.has(word.chapter))
    if (!words.length) throw new Error('Selected chapters contain no words')
  }
  const copied = new Map()
  const generated = new Map()
  const media = new Set()
  const images = new Set()
  const audio = new Set()
  const add = async url => {
    const relative = localAssetPath(url)
    if (!owned(relative)) throw new Error(`Unexpected public dependency: ${relative}`)
    if (!copied.has(relative)) copied.set(relative, await safeFile(publicRoot, relative))
    return relative
  }
  for (const word of words) {
    images.add(await add(word.imageUrl))
    media.add(localAssetPath(word.imageUrl))
    // Only this build copy changes: phone zoom uses the same complete preview.
    word.imageZoomUrl = word.imageUrl
    if (word.audioUrl) {
      const relative = await add(word.audioUrl)
      audio.add(relative)
      media.add(relative)
    }
  }

  // Derive dictionary files from the actual loader so future additions cannot
  // accidentally disappear from offline builds. No evaluation of app code.
  const app = await readFile(path.join(projectRoot, 'src/App.tsx'), 'utf8')
  const referenceBlock = app.match(/const files:\s*\[keyof StudyResources,\s*string\]\[\]\s*=\s*\[([\s\S]*?)\n\s*\]/)?.[1]
  const referenceNames = [...(referenceBlock || '').matchAll(/\[\s*'[^']+'\s*,\s*'([^']+\.json)'\s*\]/g)].map(match => match[1])
  if (!referenceNames.length) throw new Error('Could not identify App dictionary dependencies')
  for (const name of referenceNames) {
    const relative = await add('/uploads/' + name)
    JSON.parse(await readFile(copied.get(relative), 'utf8'))
  }
  for (const relative of [...LICENSES, 'manifest.webmanifest', 'app-icon.svg', 'favicon.svg']) await add(relative)
  const webManifest = JSON.parse(await readFile(copied.get('manifest.webmanifest'), 'utf8'))
  for (const icon of webManifest.icons || []) await add(icon.src)

  const readme = await readFile(path.join(projectRoot, 'README.md'), 'utf8')
  const notices = readme.match(/## 内容来源\s*\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1]?.trim()
  if (!notices) throw new Error('Missing content attribution in README.md')
  generated.set('SOURCE_NOTICES.txt', '词间内容来源\n\n' + notices + '\n')
  generated.set('course.json', JSON.stringify(packed))
  const currentFiles = new Set([...copied.keys(), ...generated.keys()])
  let previous = []
  try {
    const record = JSON.parse(await readFile(await safeFile(output, MANIFEST), 'utf8'))
    if (record.producer !== PRODUCER || !Array.isArray(record.files)) throw new Error('Unexpected Android asset manifest')
    previous = record.files.map(item => localAssetPath(item.path))
    if (previous.some(relative => !owned(relative))) throw new Error('Previous manifest contains files not owned by this script')
  } catch (error) { if (error.code !== 'ENOENT') throw error }

  // All sources were validated before touching the existing package contents.
  for (const [relative, source] of copied) await copyFile(source, await safeDestination(output, relative))
  for (const [relative, contents] of generated) await writeFile(await safeDestination(output, relative), contents, 'utf8')
  for (const relative of previous) {
    if (currentFiles.has(relative)) continue
    try { await unlink(await safeFile(output, relative)) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }

  const files = []
  for (const relative of [...currentFiles].sort()) {
    const absolute = await safeFile(output, relative)
    files.push({ path: relative, bytes: (await stat(absolute)).size })
  }
  const fileBytes = new Map(files.map(file => [file.path, file.bytes]))
  const summary = {
    producer: PRODUCER,
    wordCount: words.length,
    chapterCount: packed.course.chapters.length,
    chapterLimit: chapterLimit ?? null,
    imageFiles: images.size,
    audioFiles: audio.size,
    dictionaryFiles: referenceNames.length,
    resourceFiles: files.length,
    resourceBytes: files.reduce((total, file) => total + file.bytes, 0),
    mediaBytes: [...media].reduce((total, relative) => total + fileBytes.get(relative), 0),
    zoomUsesPreview: true,
  }
  await writeFile(await safeDestination(output, MANIFEST), JSON.stringify({ ...summary, files }, null, 2) + '\n', 'utf8')
  // Ensure source metadata was never changed and every packaged media URL resolves.
  if (await readFile(path.join(publicRoot, 'course.json'), 'utf8') !== originalCourse) throw new Error('Source course changed during packaging; rebuild from a stable snapshot')
  for (const word of packed.course.words) for (const field of ['imageUrl', 'imageZoomUrl', 'audioUrl']) {
    if (word[field]) await safeFile(output, localAssetPath(word[field]))
  }
  const packageFiles = []
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name)
      if (entry.isDirectory()) await collect(absolute)
      else if (entry.isFile()) packageFiles.push((await stat(absolute)).size)
      else throw new Error(`Unexpected link in the package: ${absolute}`)
    }
  }
  await collect(output)
  return { ...summary, packageFiles: packageFiles.length, packageBytes: packageFiles.reduce((total, size) => total + size, 0) }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  Promise.resolve().then(() => {
    const args = process.argv.slice(2)
    if (args.length === 0) return prepareAndroidAssets()
    if (args.length !== 2 || args[0] !== '--chapters' || !/^\d+$/.test(args[1])) throw new Error('Usage: node scripts/prepare-android-assets.mjs [--chapters 3]')
    return prepareAndroidAssets(PROJECT, { chapters: Number(args[1]) })
  }).then(summary => console.log(JSON.stringify({ ...summary, resourceMiB: +(summary.resourceBytes / 1024 ** 2).toFixed(2) }, null, 2))).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
