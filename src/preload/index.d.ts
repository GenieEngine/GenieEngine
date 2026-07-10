import type { GenieEngineApi } from '../shared/types'

declare global {
  interface Window {
    api: GenieEngineApi
  }
}

export {}
