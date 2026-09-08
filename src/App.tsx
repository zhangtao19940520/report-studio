import { useEffect, useMemo, useState } from 'react'
import type { Project, ReportDetail, ReportIndex, SummaryReport } from '../shared/types'
import { api } from './api'
import { ReportView } from './ReportView'
import { GenerateModal } from './GenerateModal'
import { SettingsModal } from './SettingsModal'
import { BackfillModal } from './BackfillModal'
import { ConfirmModal } from './ConfirmModal'
import { ProjectModal } from './ProjectModal'
import { ExportModal } from './ExportModal'
import { SummaryListView, SummaryDetailView } from './SummaryView'
import { SummaryGenerateModal } from './SummaryGenerateModal'
import { loadSettings, saveSettings, applySettings, type Settings } from './settings'
import type { GenResult } from '../electron/preload/index'
import './app.css'

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const todayStr = () => new Date().toISOString().slice(0, 10)
const weekdayOf = (d: string) => WEEKDAY[new Date(d + 'T00:00:00').getDay()]

export default function App() {
  const [projects, setProjects] = useState<Project[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [reportList, setReportList] = useState<ReportIndex[]>([])
  const [activeDate, setActiveDate] = useState<string | null>(null)
  const [detail, setDetail] = useState<ReportDetail | null>(null)
  const [showModal, setShowModal] = useState(false)
  const [editProject, setEditProject] = useState<Project | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showBackfill, setShowBackfill] = useState(false)
  const [pendingGen, setPendingGen] = useState<{ date: string; force: boolean } | null>(null)
  const [tab, setTab] = useState<'daily' | 'summary'>('daily')
  const [summaryList, setSummaryList] = useState<SummaryReport[]>([])
  const [activeSummaryId, setActiveSummaryId] = useState<number | null>(null)
  const [showSummaryGen, setShowSummaryGen] = useState(false)
  const [summaryDetail, setSummaryDetail] = useState<SummaryReport | null>(null)
  const [pendingSummaryDel, setPendingSummaryDel] = useState<SummaryReport | null>(null)
  const [pendingSummaryRegen, setPendingSummaryRegen] = useState<SummaryReport | null>(null)
  const [settings, setSettings] = useState<Settings>(() => loadSettings())

  useEffect(() => {
    applySettings(settings)
  }, []) // 挂载后应用持久化设置（此时 .app 已渲染）

  const changeSettings = (s: Settings) => {
    setSettings(s)
    applySettings(s)
    saveSettings(s)
  }
  const [genLogs, setGenLogs] = useState<string[]>([])
  const [genDate, setGenDate] = useState<string | null>(null)
  const [genDone, setGenDone] = useState<GenResult | null>(null)
  const [generating, setGenerating] = useState(false)
  const [detailRev, setDetailRev] = useState(0) // 重新生成后强制刷新详情
  const [detailMissing, setDetailMissing] = useState(false) // 时间轴条目对应的行已不存在（历史 bug 删除残留）
  const [collapsedMonths, setCollapsedMonths] = useState<Set<string>>(new Set())

  const timelineGroups = useMemo(() => {
    const groups: { month: string; items: ReportIndex[] }[] = []
    for (const r of reportList) {
      const month = r.report_date.slice(0, 7) // YYYY-MM
      const last = groups[groups.length - 1]
      if (last && last.month === month) last.items.push(r)
      else groups.push({ month, items: [r] })
    }
    return groups
  }, [reportList])

  const toggleMonth = (month: string) => {
    setCollapsedMonths((prev) => {
      const next = new Set(prev)
      if (next.has(month)) next.delete(month)
      else next.add(month)
      return next
    })
  }

  const active = projects.find((p) => p.id === activeId) ?? null

  const refreshProjects = async () => {
    const list = await api.project.list()
    setProjects(list)
    setActiveId((cur) => (cur && list.some((p) => p.id === cur) ? cur : list[0]?.id ?? null))
  }

  useEffect(() => {
    void refreshProjects()
  }, [])

  useEffect(() => {
    if (activeId == null) return
    void api.report.list(activeId).then((rows) => {
      setReportList(rows)
      setActiveDate(rows[0]?.report_date ?? null)
    })
    void api.summary.list(activeId).then((rows) => {
      setSummaryList(rows)
      setActiveSummaryId((cur) => (cur && rows.some((s) => s.id === cur) ? cur : rows[0]?.id ?? null))
    })
  }, [activeId])

  useEffect(() => {
    if (activeSummaryId == null) {
      setSummaryDetail(null)
      return
    }
    void api.summary.get(activeSummaryId).then((s) => setSummaryDetail(s ?? null))
  }, [activeSummaryId])

  useEffect(() => {
    if (activeId == null || !activeDate) {
      setDetail(null)
      setDetailMissing(false)
      return
    }
    setDetailMissing(false)
    void api.report
      .get(activeId, activeDate)
      .then((d) => {
        setDetail(d ?? null)
        setDetailMissing(!d)
      })
      .catch(() => setDetailMissing(true))
  }, [activeId, activeDate, detailRev])

  const weekStats = useMemo(() => {
    const today = new Date()
    const monday = new Date(today)
    monday.setDate(today.getDate() - ((today.getDay() + 6) % 7))
    const from = monday.toISOString().slice(0, 10)
    const rows = reportList.filter((r) => r.report_date >= from)
    return {
      commits: rows.reduce((s, r) => s + r.commit_count, 0),
      ins: rows.reduce((s, r) => s + (r.insertions ?? 0), 0)
    }
  }, [reportList])

  const today = todayStr()
  const todayDone = reportList.some((r) => r.report_date === today)

  useEffect(() => {
    const offLog = api.report.onLog((line) => setGenLogs((prev) => [...prev, line]))
    const offState = api.report.onState((r) => {
      setGenerating(false)
      setGenDone(r)
      if (activeId != null) {
        // 成功/失败都刷新列表：清掉被删除或残留的时间轴条目
        void api.report.list(activeId).then((rows) => {
          setReportList(rows)
          if (r.date && !rows.some((x) => x.report_date === r.date)) {
            // 该日行已不存在（如生成失败），回退到最新一条
            setActiveDate(rows[0]?.report_date ?? null)
          } else if (r.date) {
            setActiveDate(r.date)
          }
          setDetailRev((v) => v + 1)
        })
      }
    })
    return () => {
      offLog()
      offState()
    }
  }, [activeId])

  const runGenerate = async (date: string, force = false) => {
    if (activeId == null || generating) return
    setGenerating(true)
    setGenLogs([])
    setGenDone(null)
    setGenDate(date)
    await api.report.generate(activeId, date, force)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <h1>
            <span className="seal">日</span>日报工作台
          </h1>
          <p>DAILY · REPORT · STUDIO</p>
        </div>
        <div className="nav-label">项目</div>
        <div className="proj-list">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`proj ${p.id === activeId ? 'active' : ''}`}
              onClick={() => setActiveId(p.id)}
            >
              <div className="proj-top">
                <span className="proj-name">{p.name}</span>
                {p.id === activeId && todayDone && (
                  <span className="dot" title="今日日报已生成" />
                )}
              </div>
              <div className="proj-meta">
                {p.id === activeId
                  ? `${reportList.length} 篇日报 · ${todayDone ? '今日 ✓' : '今日待生成'}`
                  : p.backend_repo ?? '未配置仓库'}
              </div>
            </div>
          ))}
        </div>
        <div className="add-proj" onClick={() => setShowModal(true)}>
          ＋ 新增项目
        </div>
        <div className="global-stat">
          <div className="row">
            <span>本周提交</span>
            <b className="hot">{weekStats.commits}</b>
          </div>
          <div className="row">
            <span>本周 +行</span>
            <b>+{weekStats.ins}</b>
          </div>
          <div className="row">
            <span>日报篇数</span>
            <b>{reportList.length}</b>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="proj-header">
          <div className="proj-title">
            <h2>
              {active?.name ?? '暂无项目'}
              {active && <small>{active.subtitle ?? ''}</small>}
            </h2>
            <div className="repos">
              {active?.backend_repo && <span>{active.backend_repo}</span>}
              {active?.frontend_repo && <span>{active.frontend_repo}</span>}
            </div>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setShowSettings(true)}>
              ⚙ 设置
            </button>
            <button className="btn" disabled={!active} onClick={() => setEditProject(active)}>
              ✎ 编辑
            </button>
            <button className="btn danger" disabled={!active} onClick={() => setConfirmDelete(true)}>
              🗑 删除
            </button>
            <button className="btn" disabled={!active} onClick={() => setShowExport(true)}>
              ⬇ 导出
            </button>
            <button
              className="btn"
              disabled={generating || activeId == null}
              onClick={() => setShowBackfill(true)}
            >
              📅 补生成
            </button>
            <button
              className="btn primary"
              disabled={generating || activeId == null}
              onClick={() => void runGenerate(todayStr())}
            >
              {generating ? '⟳ 生成中…' : '▶ 立即生成日报'}
            </button>
          </div>
        </div>
        <div className="tab-bar">
          <button
            className={`tab-btn ${tab === 'daily' ? 'on' : ''}`}
            onClick={() => setTab('daily')}
          >
            日报
          </button>
          <button
            className={`tab-btn ${tab === 'summary' ? 'on' : ''}`}
            onClick={() => setTab('summary')}
          >
            汇总
          </button>
        </div>
        <div className="content">
          {tab === 'summary' ? (
            <SummaryListView
              list={summaryList}
              activeId={activeSummaryId}
              onSelect={setActiveSummaryId}
              onGenerate={() => setShowSummaryGen(true)}
              onDelete={(s) => setPendingSummaryDel(s)}
              onRegenerate={(s) => setPendingSummaryRegen(s)}
            />
          ) : reportList.length > 0 ? (
            <>
              <nav className="timeline">
                <div className="nav-label" style={{ padding: '4px 14px 12px' }}>
                  日期
                </div>
                {timelineGroups.map((g) => (
                  <div key={g.month} className="tl-month">
                    <div className="tl-month-head" onClick={() => toggleMonth(g.month)}>
                      <span className={`tl-arrow ${collapsedMonths.has(g.month) ? '' : 'open'}`}>
                        ›
                      </span>
                      <span className="tl-month-name">{g.month}</span>
                      <span className="tl-month-count">{g.items.length}</span>
                    </div>
                    {!collapsedMonths.has(g.month) &&
                      g.items.map((r) => (
                        <div
                          key={r.id}
                          className={`tl-item ${r.report_date === activeDate ? 'active' : ''} ${
                            r.commit_count === 0 ? 'empty' : ''
                          }`}
                          onClick={() => setActiveDate(r.report_date)}
                        >
                          {r.report_date}
                          <span className="weekday">{weekdayOf(r.report_date)}</span>
                        </div>
                      ))}
                  </div>
                ))}
              </nav>
              {detail ? (
                <ReportView
                  detail={detail}
                  generating={generating}
                  onRegenerate={() => setPendingGen({ date: detail.report_date, force: true })}
                />
              ) : detailMissing && activeDate ? (
                <div className="empty-state">
                  <div>
                    <div className="glyph">缺</div>
                    <p>{activeDate} 的日报数据缺失</p>
                    <button
                      className="btn primary"
                      style={{ marginTop: 16 }}
                      disabled={generating}
                      onClick={() => setPendingGen({ date: activeDate, force: true })}
                    >
                      ↻ 重新生成该日日报
                    </button>
                  </div>
                </div>
              ) : (
                <div className="empty-state">
                  <div>
                    <div className="glyph">無</div>
                    <p>加载中…</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div>
                <div className="glyph">無</div>
                <p>{active ? '暂无日报 · 点击「立即生成日报」' : '请先新增项目'}</p>
              </div>
            </div>
          )}
          {tab === 'summary' &&
            (summaryDetail ? (
              <SummaryDetailView s={summaryDetail} />
            ) : (
              <div className="empty-state">
                <div>
                  <div className="glyph">無</div>
                  <p>暂无汇总 · 点击「生成汇总」</p>
                </div>
              </div>
            ))}
        </div>
      </main>
      {showModal && (
        <ProjectModal
          onClose={() => setShowModal(false)}
          onSaved={async () => {
            setShowModal(false)
            await refreshProjects()
          }}
        />
      )}
      {editProject && (
        <ProjectModal
          initial={editProject}
          onClose={() => setEditProject(null)}
          onSaved={async () => {
            setEditProject(null)
            await refreshProjects()
          }}
        />
      )}
      {confirmDelete && active && (
        <ConfirmModal
          title="删除项目确认"
          message={`将删除项目「${active.name}」及其全部 ${reportList.length} 篇日报记录，此操作不可恢复，是否继续？`}
          confirmText="确认删除"
          onClose={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false)
            if (activeId != null) {
              await api.project.delete(activeId)
              setActiveId(null)
              setReportList([])
              await refreshProjects()
            }
          }}
        />
      )}
      {showSummaryGen && activeId != null && (
        <SummaryGenerateModal
          projectId={activeId}
          onClose={() => setShowSummaryGen(false)}
          onDone={async () => {
            setShowSummaryGen(false)
            if (activeId != null) {
              const rows = await api.summary.list(activeId)
              setSummaryList(rows)
              setActiveSummaryId(rows[0]?.id ?? null)
              setTab('summary')
            }
          }}
        />
      )}
      {pendingSummaryDel && (
        <ConfirmModal
          title="删除汇总确认"
          message={`将删除 ${pendingSummaryDel.date_from} ~ ${pendingSummaryDel.date_to} 的汇总报告，此操作不可恢复，是否继续？`}
          confirmText="确认删除"
          onClose={() => setPendingSummaryDel(null)}
          onConfirm={async () => {
            const id = pendingSummaryDel.id
            setPendingSummaryDel(null)
            await api.summary.delete(id)
            if (activeId != null) {
              const rows = await api.summary.list(activeId)
              setSummaryList(rows)
              setActiveSummaryId(rows[0]?.id ?? null)
            }
          }}
        />
      )}
      {pendingSummaryRegen && (
        <ConfirmModal
          title="重新生成汇总确认"
          message={`将删除并重新生成 ${pendingSummaryRegen.date_from} ~ ${pendingSummaryRegen.date_to} 的汇总报告（重新调用 AI 归纳），是否继续？`}
          confirmText="确认重新生成"
          onClose={() => setPendingSummaryRegen(null)}
          onConfirm={async () => {
            const s = pendingSummaryRegen
            setPendingSummaryRegen(null)
            if (activeId == null) return
            setTab('summary')
            // 复用生成日志弹窗展示进度
            setGenerating(true)
            setGenLogs([])
            setGenDone(null)
            setGenDate(`${s.date_from} ~ ${s.date_to}（汇总）`)
            const r = await api.summary.generate(activeId, s.kind, s.date_from, s.date_to)
            setGenerating(false)
            setGenDone(r)
            const rows = await api.summary.list(activeId)
            setSummaryList(rows)
            setActiveSummaryId(rows[0]?.id ?? null)
          }}
        />
      )}
      {showExport && activeId != null && (
        <ExportModal
          projectId={activeId}
          currentDate={activeDate}
          earliest={reportList.length ? reportList[reportList.length - 1].report_date : null}
          onClose={() => setShowExport(false)}
        />
      )}
      {showBackfill && (
        <BackfillModal
          existingDates={new Set(reportList.map((r) => r.report_date))}
          onClose={() => setShowBackfill(false)}
          onSubmit={(date) => {
            setShowBackfill(false)
            setPendingGen({ date, force: false })
          }}
        />
      )}
      {pendingGen && (
        <ConfirmModal
          title={pendingGen.force ? '重新生成确认' : '补生成确认'}
          message={
            pendingGen.force
              ? `将删除 ${pendingGen.date} 的现有日报并重新采集生成，是否继续？`
              : `将为 ${pendingGen.date} 采集提交并生成日报，是否继续？`
          }
          confirmText={pendingGen.force ? '确认重新生成' : '确认生成'}
          onClose={() => setPendingGen(null)}
          onConfirm={() => {
            const { date, force } = pendingGen
            setPendingGen(null)
            void runGenerate(date, force)
          }}
        />
      )}
      {showSettings && (
        <SettingsModal
          settings={settings}
          onClose={() => setShowSettings(false)}
          onChange={changeSettings}
        />
      )}
      {genDate && (
        <GenerateModal
          project={active?.name ?? ''}
          date={genDate}
          lines={genLogs}
          done={genDone}
          onClose={() => {
            setGenDate(null)
            setGenLogs([])
            setGenDone(null)
          }}
          onRegenerate={() => {
            setGenDate(null)
            setPendingGen({ date: genDate, force: true })
          }}
        />
      )}
    </div>
  )
}
