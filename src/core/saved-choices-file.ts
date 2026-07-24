import {
  MAX_SAVED_CHOICES_BACKUP_SIZE,
  serializeSavedChoicesBackup,
  type SavedChoicesBackup,
} from './saved-choices'

interface ObjectUrlApi {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export function savedChoicesBackupFilename(exportedAt: string): string {
  const date = exportedAt.slice(0, 10)
  return `npu-saved-choices-${date}.json`
}

export function downloadSavedChoicesBackup(
  backup: SavedChoicesBackup,
  documentRef: Document = document,
  objectUrlApi: ObjectUrlApi = URL,
): string {
  const filename = savedChoicesBackupFilename(backup.exportedAt)
  const blob = new Blob([serializeSavedChoicesBackup(backup)], {
    type: 'application/json;charset=utf-8',
  })
  const url = objectUrlApi.createObjectURL(blob)
  const link = documentRef.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  documentRef.body.appendChild(link)

  try {
    link.click()
  } finally {
    link.remove()
    window.setTimeout(() => objectUrlApi.revokeObjectURL(url), 0)
  }

  return filename
}

export function chooseSavedChoicesBackupFile(
  documentRef: Document = document,
): Promise<File | null> {
  return new Promise((resolve) => {
    const input = documentRef.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.style.display = 'none'

    let settled = false
    const finish = (file: File | null): void => {
      if (settled) return
      settled = true
      input.remove()
      resolve(file)
    }

    input.addEventListener('change', () => finish(input.files?.[0] ?? null))
    input.addEventListener('cancel', () => finish(null))
    documentRef.body.appendChild(input)
    input.click()
  })
}

export async function readSavedChoicesBackupFile(file: File): Promise<string> {
  if (file.size > MAX_SAVED_CHOICES_BACKUP_SIZE) {
    throw new Error('The selected backup is too large.')
  }
  return file.text()
}
