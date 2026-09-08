import { contextBridge, ipcRenderer } from 'electron'
import type {
  Project,
  ProjectInput,
  ReportDetail,
  ReportIndex,
  SummaryKind,
  SummaryReport
} from '../../shared/types'

export interface GenResult {
  status: 'success' | 'failed' | 'skipped'
  message: string
  date?: string
}

const api = {
  project: {
    list: (): Promise<Project[]> => ipcRenderer.invoke('project:list'),
    get: (id: number): Promise<Project | undefined> => ipcRenderer.invoke('project:get', id),
    create: (input: ProjectInput): Promise<Project> => ipcRenderer.invoke('project:create', input),
    update: (id: number, input: Partial<ProjectInput>): Promise<Project | undefined> =>
      ipcRenderer.invoke('project:update', id, input),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke('project:delete', id)
  },
  report: {
    list: (projectId: number): Promise<ReportIndex[]> =>
      ipcRenderer.invoke('report:list', projectId),
    get: (projectId: number, date: string): Promise<ReportDetail | undefined> =>
      ipcRenderer.invoke('report:get', projectId, date),
    generate: (projectId: number, date: string, force = false): Promise<GenResult> =>
      ipcRenderer.invoke('report:generate', projectId, date, force),
    onLog: (listener: (line: string) => void): (() => void) => {
      const h = (_e: unknown, line: string): void => listener(line)
      ipcRenderer.on('gen:log', h)
      return () => ipcRenderer.removeListener('gen:log', h)
    },
    onState: (listener: (r: GenResult) => void): (() => void) => {
      const h = (_e: unknown, r: GenResult): void => listener(r)
      ipcRenderer.on('gen:state', h)
      return () => ipcRenderer.removeListener('gen:state', h)
    }
  },
  export: {
    run: (
      projectId: number,
      from: string,
      to: string,
      format: 'md' | 'excel' | 'pdf'
    ): Promise<{ ok: true; path: string } | { ok: false; message: string }> =>
      ipcRenderer.invoke('export:run', projectId, from, to, format)
  },
  summary: {
    list: (projectId: number): Promise<SummaryReport[]> =>
      ipcRenderer.invoke('summary:list', projectId),
    get: (id: number): Promise<SummaryReport | undefined> => ipcRenderer.invoke('summary:get', id),
    missing: (projectId: number, from: string, to: string): Promise<string[]> =>
      ipcRenderer.invoke('summary:missing', projectId, from, to),
    delete: (id: number): Promise<boolean> => ipcRenderer.invoke('summary:delete', id),
    generate: (
      projectId: number,
      kind: SummaryKind,
      from: string,
      to: string
    ): Promise<{ status: 'success' | 'failed'; message: string }> =>
      ipcRenderer.invoke('summary:generate', projectId, kind, from, to)
  },
  llm: {
    getConfig: (): Promise<{
      mode: 'cli' | 'api'
      protocol: 'openai' | 'anthropic'
      openai: { api_url: string | null; api_key: string | null; model: string | null }
      anthropic: { api_url: string | null; api_key: string | null; model: string | null }
    }> => ipcRenderer.invoke('llm:getConfig'),
    saveConfig: (cfg: {
      mode: 'cli' | 'api'
      protocol: 'openai' | 'anthropic'
      openai: { api_url: string | null; api_key: string | null; model: string | null }
      anthropic: { api_url: string | null; api_key: string | null; model: string | null }
    }): Promise<void> => ipcRenderer.invoke('llm:saveConfig', cfg),
    test: (
      cfg: {
        mode: 'cli' | 'api'
        protocol: 'openai' | 'anthropic'
        openai: { api_url: string | null; api_key: string | null; model: string | null }
        anthropic: { api_url: string | null; api_key: string | null; model: string | null }
      },
      protocol: 'openai' | 'anthropic'
    ): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('llm:test', cfg, protocol)
  }
}

export type Api = typeof api
contextBridge.exposeInMainWorld('api', api)
