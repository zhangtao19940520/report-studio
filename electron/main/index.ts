import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { openDb } from './db'
import { ProjectService } from './services/project'
import { ReportService } from './services/report'
import { GenerateService } from './services/generate'
import { ExportService } from './services/export'
import { SummaryService } from './services/summary'
import { LlmService } from './services/llm'
import { registerIpc } from './ipc'

// 双击托盘/历史 cwd 在打包后不对，统一锚定到用户主目录下的日报目录
function resolveReportsDir(): string {
  if (process.env.REPORTS_DIR) return process.env.REPORTS_DIR
  return path.join(app.getPath('home'), 'Documents', 'report-studio')
}

let win: BrowserWindow | null = null

declare global {
  // eslint-disable-next-line no-var
  var __reportsDir: string
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1000,
    minHeight: 680,
    show: false,
    title: '日报工作台',
    backgroundColor: '#111418',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  // 默认最大化，避免首帧白窗闪烁
  win.maximize()
  win.once('ready-to-show', () => win?.show())
}

app.whenReady().then(() => {
  const db = openDb()
  const projects = new ProjectService(db)
  const reports = new ReportService(db)
  projects.seedDefaults([
    {
      key: 'demo-a',
      name: 'Demo-A',
      subtitle: 'DEMO PROJECT A',
      backend_repo: path.join(app.getPath('home'), 'Projects/demo-a-server'),
      frontend_repo: path.join(app.getPath('home'), 'Projects/demo-a-web')
    },
    {
      key: 'demo-b',
      name: 'Demo-B',
      subtitle: 'DEMO PROJECT B',
      backend_repo: path.join(app.getPath('home'), 'Projects/demo-b-server'),
      frontend_repo: path.join(app.getPath('home'), 'Projects/demo-b-web')
    }
  ])
  const llm = new LlmService(db)
  // 每次生成时按当前配置解析 runner，模式切换即时生效
  const llmRunner = async (prompt: string, onLog: (l: string) => void) => {
    const r = await llm.runner(onLog)
    return r(prompt, onLog)
  }
  const generate = new GenerateService(db, reports, (id) => projects.get(id), llmRunner)
  const exporter = new ExportService(db, reports, (id) => projects.get(id))
  const summarySvc = new SummaryService(db, reports, (id) => projects.get(id), llmRunner)
  registerIpc(projects, reports, generate, exporter, summarySvc, llm, () => win?.webContents ?? null)
  const reportsDir = resolveReportsDir()
  globalThis.__reportsDir = reportsDir
  // 一次性导入现有 md 日报（幂等，可重复执行）
  reports.importFromMd(reportsDir, projects.list().map((p) => ({ id: p.id, key: p.key })))
  createWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
