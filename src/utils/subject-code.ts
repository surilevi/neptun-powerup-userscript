const SUBJECT_CODE_CANDIDATE_RE = /\b[A-Z0-9][A-Z0-9-]{5,24}\b/g

function countMatches(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0
}

export function normalizeSubjectCode(value: string): string {
  return value.replace(/\s+/g, '').trim().toUpperCase()
}

export function isLikelySubjectCode(value: string): boolean {
  const normalized = normalizeSubjectCode(value)

  if (normalized.length < 6 || normalized.length > 25) return false
  if (normalized.includes('_') || normalized.includes('.')) return false
  if (!/[A-Z]/.test(normalized) || !/\d/.test(normalized)) return false

  const letterCount = countMatches(normalized, /[A-Z]/g)
  const digitCount = countMatches(normalized, /\d/g)

  return letterCount >= 2 && digitCount >= 2
}

export function extractSubjectCodeFromText(text: string): string | null {
  const normalizedText = text.replace(/\s+/g, ' ').trim().toUpperCase()
  if (!normalizedText) return null

  let bestCandidate: string | null = null
  let bestScore = -1

  for (const match of normalizedText.matchAll(SUBJECT_CODE_CANDIDATE_RE)) {
    const candidate = normalizeSubjectCode(match[0])
    if (!isLikelySubjectCode(candidate)) continue

    const position = match.index ?? 0
    const relativePosition = normalizedText.length > 0 ? position / normalizedText.length : 0
    const score =
      candidate.length * 10 + (candidate.includes('-') ? 15 : 0) + Math.round(relativePosition * 10)

    if (score > bestScore) {
      bestCandidate = candidate
      bestScore = score
    }
  }

  return bestCandidate
}
