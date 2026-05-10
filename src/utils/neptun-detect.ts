const SUPPORTED_PORTAL_PREFIXES = [
  '/hallgatoi',
  '/hallgato_ng',
  '/hallgatoing',
  '/ujhallgato',
] as const

function safeLower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase()
}

export function isSupportedPortalPath(pathname: string): boolean {
  const path = safeLower(pathname)
  return SUPPORTED_PORTAL_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

export function hasNeptunFingerprint(doc: Document = document): boolean {
  const title = safeLower(doc.title)
  if (title.includes('neptun')) return true

  const html = doc.documentElement
  const htmlText = safeLower(html?.textContent?.slice(0, 2000))
  if (htmlText.includes('neptun web') || htmlText.includes('neptun')) return true

  const attributedNodes = Array.from(
    doc.querySelectorAll('script[src], link[href], img[src], meta[content]'),
  )

  return attributedNodes.some((node) => {
    const values = [
      'src' in node ? node.getAttribute('src') : null,
      'href' in node ? node.getAttribute('href') : null,
      node.getAttribute('content'),
    ]

    return values.some((value) => safeLower(value).includes('neptun'))
  })
}

export function hasNeptunSessionStorage(storage: Storage = sessionStorage): boolean {
  try {
    return [
      'access_token',
      'refresh_token_expiration',
      'login_type',
      'tabId',
    ].some((key) => storage.getItem(key) !== null)
  } catch {
    return false
  }
}

export function isLikelyNeptunPortal(
  locationLike: Pick<Location, 'pathname'> = window.location,
  doc: Document = document,
  storage: Storage = sessionStorage,
): boolean {
  if (!isSupportedPortalPath(locationLike.pathname)) return false

  return hasNeptunSessionStorage(storage) || hasNeptunFingerprint(doc)
}
