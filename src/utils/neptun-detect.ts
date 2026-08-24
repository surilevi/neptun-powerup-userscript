const SUPPORTED_PORTAL_PREFIXES = [
  '/hallgatoi',
  '/hallgato_ng',
  '/hallgatoing',
  '/ujhallgato',
] as const

function safeLower(value: string | null | undefined): string {
  return (value ?? '').toLowerCase()
}

function hasNeptunTitle(doc: Document): boolean {
  return /\bneptun(?:\s+web|\.net)?\b/i.test(doc.title)
}

function hasNeptunAssetMarker(doc: Document): boolean {
  const attributedNodes = Array.from(
    doc.querySelectorAll('script[src], link[href], img[src], meta[content]'),
  )

  return attributedNodes.some((node) => {
    const values = [
      'src' in node ? node.getAttribute('src') : null,
      'href' in node ? node.getAttribute('href') : null,
      node.getAttribute('content'),
    ]

    return values.some((value) => {
      const marker = safeLower(value)
      return marker.includes('neptun') || marker.includes('/hallgato')
    })
  })
}

function hasNeptunAppShell(doc: Document): boolean {
  return Boolean(
    doc.querySelector(
      ['app-root', 'app-login', 'app-footer', 'app-header', '[data-neptun]', '[ng-version]'].join(
        ',',
      ),
    ),
  )
}

export function isSupportedPortalPath(pathname: string): boolean {
  const path = safeLower(pathname)
  return SUPPORTED_PORTAL_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  )
}

export function hasNeptunFingerprint(doc: Document = document): boolean {
  if (hasNeptunTitle(doc)) return true

  return hasNeptunAppShell(doc) && hasNeptunAssetMarker(doc)
}

export function hasNeptunSessionStorage(storage: Storage = sessionStorage): boolean {
  try {
    return [
      'access_token',
      'access_token_expiration_date',
      'session_expiration_date',
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
