import type { ModuleApi } from '../../types/modules'
import { PLANNER_TIMING } from './planner-policy'

export interface CourseSelections {
  [subjectCode: string]: string[]
}

/** Max time to wait for a panel to expand. Sourced from the shared timing policy. */
export const WAIT_TIMEOUT_MS = PLANNER_TIMING.panelExpandTimeoutMs

export const STORAGE_KEY = 'courseSelections'

let api: ModuleApi | null = null
let isEnrolling = false
let routeUnsub: (() => void) | null = null

export function getApi(): ModuleApi | null {
  return api
}

export function setApi(value: ModuleApi | null): void {
  api = value
}

export function getIsEnrolling(): boolean {
  return isEnrolling
}

export function setIsEnrolling(value: boolean): void {
  isEnrolling = value
}

export function getRouteUnsub(): (() => void) | null {
  return routeUnsub
}

export function setRouteUnsub(value: (() => void) | null): void {
  routeUnsub = value
}
