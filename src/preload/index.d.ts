import type { OpenGenieApi } from '../shared/types'

declare global {
  interface Window {
    api: OpenGenieApi
  }
}

export {}
