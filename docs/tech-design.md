# 技术设计文档 — 日报工作台（Daily Report Studio）

> 状态：设计定稿 v1.0 · 配套：[产品设计](./product-design.md)

## 1. 技术选型与理由

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面框架 | Electron 33 + electron-vite | 核心是调 shell（git / claude CLI）+ 渲染 MD，Node `child_process` 生态最顺；无 Rust 背景排除 Tauri |
| 前端 | React 18 + TypeScript + Zustand | `prototype.html` 可组件化迁移；Zustand 轻量够用 |
| 数据库 | better-sqlite3（主进程，同步 API） | 嵌入式、零运维、事务简单 |
| Markdown | react-markdown + remark-gfm | 渲染日报正文 |
| 测试 | Vitest（服务层单测）+ Playwright（E2E，M4 引入） | 解析器/GitService 纯逻辑可测性高 |

## 2. 进程架构

```
┌─ Renderer（React UI）────────────────────┐
│  Sidebar / Timeline / ReportView /       │
│  TerminalPanel / AddProjectModal         │
└──────────────┬───────────────────────────┘
               │ IPC（contextBridge，仅白名单方法）
┌──────────────┴───────────────────────────┐
│  Main（Node）                             │
│  ├ ProjectService    项目 CRUD            │
│  ├ ReportService     md 解析 / 索引 upsert │
│  ├ GitService        git log / stat 采集   │
│  ├ GenerateService   编排：采集→claude→写文件│
│  └ Db                better-sqlite3        │
└───────────────────────────────────────────┘
```

安全约束：`contextIsolation: true`、`nodeIntegration: false`，渲染进程不接触 fs / child_process。

### IPC API 契约（preload 暴露）

```ts
window.api = {
  // 项目
  listProjects(): Promise<Project[]>
  createProject(input: ProjectInput): Promise<Project>
  updateProject(id, input): Promise<Project>
  deleteProject(id): Promise<void>
  // 日报
  listReports(projectId): Promise<ReportIndex[]>       // 读 DB 索引
  getReportDetail(projectId, date): Promise<ReportDetail> // 读 md 并解析
  // 生成
  generateReport(projectId): Promise<GenerationResult>
  // 事件（main → renderer）
  onGenerateLog(listener: (line: string) => void): () => void
  onGenerateState(listener: (s: GenState) => void): () => void  // running|success|failed|skipped
}
```

## 3. 数据模型

```sql
CREATE TABLE project (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,      -- 'siem'
  name TEXT NOT NULL,
  subtitle TEXT,
  backend_repo TEXT, frontend_repo TEXT,
  git_author TEXT NOT NULL DEFAULT 'demo-user',
  created_at TEXT NOT NULL
);

CREATE TABLE report (            -- 日报数据唯一来源（含正文）
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  report_date TEXT NOT NULL,     -- 'YYYY-MM-DD'
  summary TEXT NOT NULL DEFAULT '[]',   -- JSON: string[] 总结要点
  commits TEXT NOT NULL DEFAULT '[]',   -- JSON: {backend:[],frontend:[]} 提交明细
  stat_backend TEXT,                    -- JSON: {files,ins,del}
  stat_frontend TEXT,
  content_md TEXT,                      -- 导出 md 时的正文快照
  commit_count INTEGER DEFAULT 0,
  files INTEGER, insertions INTEGER, deletions INTEGER,
  UNIQUE(project_id, report_date)
);

CREATE TABLE generation_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL,          -- running|success|failed|skipped
  log TEXT
);
```

DB 路径：`app.getPath('userData')/report-studio.db`。建表脚本带 `PRAGMA user_version` 做版本迁移。

## 4. 核心流程

### 4.1 生成日报（GenerateService.run）

与脚本的关键差异：**不再让子 Claude 写文件**，claude -p 只输出结构化 JSON，主进程组装数据落 SQLite（正文不再写 md 文件，md 仅作为导出格式）。

```
1. 幂等检查：report 表已有该日期 → status=skipped，返回
2. GitService.collect(repo, author, date)
   ├ git log --all --since --until --author --no-merges --pretty='%h|%ad|%s' --date=format:'%H:%M'
   └ 对每个 commit: git show --shortstat 汇总（复刻脚本 collect_stat）
3. spawn('claude', ['-p', prompt, '--output-format', 'json'])
   prompt：给出提交明细，要求仅返回 {"summary": string[]}（2~6 条，按主题归纳）
   失败/超时(默认120s)：status=failed，可重试
4. 组装结构化数据（summary/commits/stat/content_md）→ upsert report 表
5. 写 generation_run
6. 全程每行 stdout → webContents.send('gen:log', line)
```

### 4.2 日报解析（ReportService.parse）

- 首次启动：扫描日报目录下 `*_work_report.md`，一次性导入 SQLite（此后 md 不再是数据源）
- 按 `^## (\d{4}-\d{2}-\d{2})$` 切分小节
- 小节内按 `###` 三级标题识别：今日工作总结 / 代码提交明细 / 变更统计
- 提交明细行正则：`- \\\`(\\w+)\\\` (\\d{2}:\\d{2}) (.+)`，前缀 `**后端**`/`**前端**` 分组
- 解析失败的小节降级为原文展示，不抛错（保证老数据兼容）

### 4.3 导出（ExportService）

- 从 report 表读取 → 按格式渲染：
  - **Markdown**：沿用现有日报格式拼字符串
  - **Excel**：用 `exceljs` 生成（列：日期/仓库/hash/时间/message；附每日统计 sheet）
  - **PDF**：渲染进程打印（`webContents.printToPDF`，专用导出视图）
- 导出范围：单日 / 项目+日期区间（周报场景）
- `dialog.showSaveDialog` 选路径，主进程写文件

## 5. 目录结构

```
report-studio/
├─ electron/
│  ├─ main/
│  │  ├─ index.ts            # 入口、窗口、IPC 注册
│  │  ├─ db.ts               # sqlite 初始化与迁移
│  │  └─ services/
│  │     ├─ project.ts
│  │     ├─ report.ts        # 含 parseReport()
│  │     ├─ git.ts
│  │     └─ generate.ts
│  └─ preload/index.ts
├─ src/                      # React 渲染层
│  ├─ components/            # Sidebar/Timeline/ReportView/TerminalPanel…
│  ├─ store/                 # Zustand
│  └─ types/
├─ tests/                    # Vitest：services 单测 + 解析器快照
└─ electron.vite.config.ts
```

## 6. 测试策略（每个功能点必须有测试）

| 模块 | 测试类型 | 用例要点 |
|---|---|---|
| report.parse | Vitest 快照 | 用仓库现有 `siem_work_report.md`、`dlp_work_report.md` 作为 fixture，断言解析出的小节/提交/统计 |
| report.parse | 单测 | 空文件、无今日总结小节、commit 格式异常 → 降级不抛错 |
| report.append | 单测 | 幂等（同日期二次追加不重复）、文件不存在时建首行 |
| git.collect | 单测（临时 git 仓库 fixture） | 作者过滤、时间窗口、shortstat 汇总、无提交返回空 |
| generate.run | 集成测试（mock claude spawn） | 成功路径 / claude 超时失败 / 已存在跳过 / generation_run 落库 |
| db | 单测 | 建表迁移、UNIQUE 冲突 upsert、级联删除 |
| UI | 手工验证清单（M3 起每功能点记录）；M4 引入 Playwright 走查生成全流程 | |

约定：PR/提交说明中注明对应测试文件；未附测试的功能点不得在 product-design.md 中勾选完成。

## 7. 里程碑进度

> 与产品设计文档 M1–M4 一致，此处跟踪技术侧完成情况。

- [x] M1 脚手架 + IPC + DB 迁移（含 db 单测）· 2026-09-04
  - 备注：better-sqlite3 需按 Electron ABI 编译（`npx @electron/rebuild -f -w better-sqlite3`）；vitest 通过 `ELECTRON_RUN_AS_NODE=1 electron` 运行以匹配 ABI（见 package.json test 脚本）
- [x] M2 解析器（含快照测试）+ 导入 + UI 只读 · 2026-09-04
  - 解析器：`electron/main/services/reportParser.ts`（兼容 dlp 平铺与 siem 嵌套缩进两种提交行格式）
  - 导入：启动时对 `{reportsDir}/{key}_work_report.md` 幂等 upsert
  - 测试：`tests/report.test.ts` 8 用例（真实快照 + 多天切分 + 容错降级 + 导入幂等）
- [x] M3 GitService（含 fixture 测试）+ generate 编排（含 mock 测试）+ 终端流式日志 · 2026-09-04
  - GitService 复刻脚本：`--all` + 作者过滤 + `--no-merges` + shortstat 聚合
  - GenerateService 注入式 ClaudeRunner（测试替换为 mock）；claude 输出解析支持 `--output-format json` 外壳与 markdown 代码块
  - 生成结果直接 upsert SQLite 并组装 content_md（不写 md 文件）
- [ ] M4 导出（md/excel/pdf，含导出内容单测）+ 打包 + Playwright E2E

### 依赖补充

- `exceljs`：Excel 导出（M4）

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| claude CLI 输出不稳定 | 只要求 JSON；解析失败重试 1 次，仍失败则 failed 且日志完整保留 |
| 历史日报格式漂移 | 解析降级为原文展示；快照测试锁定已知格式 |
| md 与 DB 索引不一致 | 文件为唯一来源，提供「重建索引」入口（重跑全量导入） |
| better-sqlite3 原生模块与 Electron ABI | 使用 electron-rebuild；打包脚本内置 |
