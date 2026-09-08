import { ipcMain, dialog, BrowserWindow, type WebContents } from 'electron'
import type { ProjectInput } from '../../shared/types'
import { ProjectService } from './services/project'
import { ReportService } from './services/report'
import { GenerateService } from './services/generate'
import { ExportService, type ExportFormat } from './services/export'
import { SummaryService } from './services/summary'
import { LlmService, type LlmConfig } from './services/llm'
import type { SummaryKind } from '../../shared/types'

const EXT: Record<ExportFormat, string> = { md: 'md', excel: 'xlsx', pdf: 'pdf' }

async function htmlToPdf(html: string): Promise<Buffer> {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    const buf = await win.webContents.printToPDF({
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      printBackground: true
    })
    return Buffer.from(buf)
  } finally {
    win.destroy()
  }
}

export function registerIpc(
  projects: ProjectService,
  reports: ReportService,
  generate: GenerateService,
  exporter: ExportService,
  summary: SummaryService,
  llm: LlmService,
  getWebContents: () => WebContents | null
): void {
  ipcMain.handle('project:list', () => projects.list())
  ipcMain.handle('project:get', (_e, id: number) => projects.get(id))
  ipcMain.handle('project:create', (_e, input: ProjectInput) => projects.create(input))
  ipcMain.handle('project:update', (_e, id: number, input: Partial<ProjectInput>) =>
    projects.update(id, input)
  )
  ipcMain.handle('project:delete', (_e, id: number) => projects.delete(id))

  ipcMain.handle('report:list', (_e, projectId: number) => reports.list(projectId))
  ipcMain.handle('report:get', (_e, projectId: number, date: string) =>
    reports.get(projectId, date)
  )

  ipcMain.handle(
    'report:generate',
    (_e, projectId: number, date: string, force = false) => {
      const wc = getWebContents()
      const onLog = (line: string) => {
        if (line) wc?.send('gen:log', line)
      }
      const result = generate.run(projectId, date, onLog, force)
      void result.then((r) => wc?.send('gen:state', { ...r, date }))
      return result
    }
  )

  ipcMain.handle(
    'export:run',
    async (_e, projectId: number, from: string, to: string, format: ExportFormat) => {
      const built = await exporter.build(projectId, from, to, format)
      if (!built.ok) return built

      const wc = getWebContents()
      const data = format === 'pdf' ? await htmlToPdf(String(built.data)) : built.data
      const canceled = await dialog.showSaveDialog(BrowserWindow.fromWebContents(wc!)!, {
        defaultPath: `${built.filenameBase}.${EXT[format]}`,
        filters: [{ name: format.toUpperCase(), extensions: [EXT[format]] }]
      })
      if (canceled.canceled || !canceled.filePath) return { ok: false, message: '已取消' }
      const fs = await import('node:fs')
      fs.writeFileSync(canceled.filePath, data)
      return { ok: true, path: canceled.filePath }
    }
  )

  ipcMain.handle('summary:list', (_e, projectId: number) => summary.list(projectId))
  ipcMain.handle('summary:get', (_e, id: number) => summary.get(id))
  ipcMain.handle('summary:missing', (_e, projectId: number, from: string, to: string) =>
    summary.missingDates(projectId, from, to)
  )
  ipcMain.handle('summary:delete', (_e, id: number) => summary.delete(id))
  ipcMain.handle(
    'summary:generate',
    (
      _e,
      projectId: number,
      kind: SummaryKind,
      from: string,
      to: string
    ) => {
      const wc = getWebContents()
      const onLog = (line: string) => {
        if (line) wc?.send('gen:log', line)
      }
      return summary.generate(projectId, kind, from, to, onLog)
    }
  )

  ipcMain.handle('llm:getConfig', () => llm.getConfig())
  ipcMain.handle('llm:saveConfig', (_e, cfg: LlmConfig) => llm.saveConfig(cfg))
  ipcMain.handle('llm:test', (_e, cfg: LlmConfig) => llm.testConnection(cfg))
}
