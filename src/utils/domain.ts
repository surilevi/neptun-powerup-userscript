/**
 * Extracts the registrable domain from a Neptun URL.
 *
 * Hungarian universities use varied subdomain patterns:
 * - hallgato.uni-mate.hu → uni-mate.hu
 * - www-h-ng.neptun.unideb.hu → unideb.hu
 * - neptun-web2.tr.pte.hu → pte.hu
 * - neptun3r.web.uni-corvinus.hu → uni-corvinus.hu
 *
 * Heuristic: the registrable domain is the last two segments of the hostname,
 * unless the second-to-last segment is hyphenated (e.g., "uni-mate"),
 * in which case it's the last two segments regardless.
 */
export function extractDomain(url: string): string {
  const hostname = new URL(url).hostname
  const parts = hostname.split('.')

  if (parts.length < 2) return hostname

  // Always take last two parts: "sze.hu", "pte.hu", "unideb.hu"
  const last2 = parts.slice(-2).join('.')

  // Check if third-to-last part starts with "uni-" (e.g., uni-mate, uni-obuda, uni-corvinus, uni-nke)
  if (parts.length >= 3) {
    const thirdFromEnd = parts[parts.length - 3]
    if (thirdFromEnd.startsWith('uni-')) {
      return parts.slice(-3).join('.')
    }
  }

  return last2
}
