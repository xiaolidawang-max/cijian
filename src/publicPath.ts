/** Resolve a site-local URL under either the local root or a GitHub Pages subdirectory. */
export function publicPath(url: string): string {
  if (!url.startsWith('/')) return url
  const base = import.meta.env?.BASE_URL || '/'
  return base + url.slice(1)
}
