export const SESSION_SECONDS = 10 * 60
export const IDLE_SECONDS = 30 * 60
export const ABSOLUTE_SECONDS = 8 * 60 * 60
export const MIN_REFRESH_SECONDS = 60
export const RENEW_WINDOW_SECONDS = 90

export type SessionTiming = {
  userId: string
  accessExpiresAt: number
  idleExpiresAt: number
  absoluteExpiresAt: number
  serverNow: number
  renewable: boolean
}
