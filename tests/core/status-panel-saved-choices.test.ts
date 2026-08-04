// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEventBus } from '../../src/core/event-bus'
import { createStatusPanel, type StatusPanel } from '../../src/core/status-panel'

let panel: StatusPanel | null = null

function createPanel(
  onExportSavedChoices: () => string | null | Promise<string | null>,
  onImportSavedChoices: () => string | null | Promise<string | null>,
): StatusPanel {
  return createStatusPanel(
    createEventBus(),
    {
      onCourseRushChange: vi.fn(),
      onExamRushChange: vi.fn(),
      onExportSavedChoices,
      onImportSavedChoices,
    },
    { courseRush: false, examRush: false },
  )
}

afterEach(() => {
  panel?.dispose()
  panel = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('status panel saved choices controls', () => {
  it('runs export and reports completion in settings', async () => {
    const onExport = vi.fn(async () => 'Exported 1 saved subject, 2 courses, and 1 exam.')
    panel = createPanel(onExport, vi.fn())

    document.querySelector<HTMLButtonElement>('#npu-export-saved-choices')?.click()

    await vi.waitFor(() => expect(onExport).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(document.querySelector('#npu-saved-choices-status')?.textContent).toContain(
        'Exported 1 saved subject',
      ),
    )
  })

  it('shows import validation errors without removing the controls', async () => {
    panel = createPanel(vi.fn(), async () => {
      throw new Error('The selected file is not a supported NPU saved choices backup.')
    })

    document.querySelector<HTMLButtonElement>('#npu-import-saved-choices')?.click()

    await vi.waitFor(() =>
      expect(document.querySelector('#npu-saved-choices-status')?.textContent).toContain(
        'not a supported NPU',
      ),
    )
    expect(document.querySelector<HTMLButtonElement>('#npu-import-saved-choices')?.disabled).toBe(
      false,
    )
  })
})
