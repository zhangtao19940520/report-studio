# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 用途

日报工作台（Daily Report Studio）：本地 Electron 桌面应用。从外部 Git 仓库采集每日提交（按作者过滤、排除 merge），经 LLM 归纳为中文工作日报与周报/月报汇总，存入本地 SQLite，支持浏览、补生成、导出 MD/Excel/PDF。

## 常用命令

```bash
npm run dev        # 开发模式（electron-vite 热更新）
npm test           # 全部 Vitest 单测
npm run typecheck  # tsc --noEmit（两个 tsconfig 都查）
npm run build      # 生产构建
npm run dist       # 打包 macOS arm64 dmg
```

运行单个测试文件：

```bash
ELECTRON_RUN_AS_NODE=1 electron node_modules/vitest/vitest.mjs run tests/git.test.ts
```

- 测试必须经 `ELECTRON_RUN_AS_NODE=1 electron` 运行 vitest，以匹配 better-sqlite3 的 Electron ABI（普通 `vitest` 会因原生模块 ABI 不符而失败）。
- 安装依赖后需 `npx @electron/rebuild -f -w better-sqlite3` 重编译原生模块；国内网络需 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`。

## 架构

Electron 33 + electron-vite，三层结构：

```
electron/main/          # 主进程：全部业务逻辑
  index.ts              # 服务装配与窗口创建
  ipc.ts                # IPC handler 注册（preload 暴露白名单 API）
  db.ts / schema.ts     # SQLite（WAL）+ user_version 版本化迁移
  services/
    project.ts          # 项目 CRUD（后端/前端仓库路径）
    git.ts              # git log 采集 + shortstat 统计
    reportParser.ts     # 既有 *_work_report.md 的解析导入
    report.ts           # 日报读取 / 幂等 upsert / md 导入
    generate.ts         # 日报生成编排
    summary.ts          # 周报/月报区间聚合
    export.ts           # MD / Excel(exceljs) / PDF(打印 HTML) 导出
    llm.ts              # LLM Provider 三通道：Claude CLI / OpenAI 兼容 / Anthropic
src/                    # React 18 渲染层（App.tsx + 各 Modal/View 组件）
shared/types.ts         # 跨进程共享类型
tests/                  # Vitest 单测（tests/fixtures 有真实 md 快照）
```

关键设计：

- **依赖注入式 LLM**：`index.ts` 构造 `llmRunner` 闭包传给 GenerateService/SummaryService——每次生成时按当前配置重新解析 provider，切换模式即时生效，服务本身不感知具体通道。
- **DB 迁移**：`schema.ts` 用 `PRAGMA user_version` 顺序执行迁移（当前 v5），改表结构时新增版本号分支，勿修改历史迁移。
- **幂等导入**：启动时 `importFromMd` 自动导入 `~/Documents/report-studio` 下的 `*_work_report.md`，可重复执行；`REPORTS_DIR` 环境变量可覆盖目录。
- **生成安全**：日报生成成功后才覆盖旧版（upsert 幂等），失败保留原数据。
- **服务构造模式**：各 Service 接收 `(db, reports, getProject, ...)` 依赖，均在 `index.ts` 装配，`registerIpc` 暴露给渲染层。

## 数据位置

SQLite 库：`~/Library/Application Support/report-studio/report-studio.db`。测试中传 `dbPath` 参数用临时库，勿在测试里写用户真实库。

## 设计文档

需求与详细设计见 `docs/product-design.md`、`docs/tech-design.md`（改动功能前先对照）。
