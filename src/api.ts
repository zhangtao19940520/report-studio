import type { Api } from '../electron/preload/index'

export const api: Api = (window as unknown as { api: Api }).api
