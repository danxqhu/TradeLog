/**
 * 每日追资金 —— 主页面
 *
 * 使用流程（与产品设计一致）：
 *   ① 刷新板块资金流（东财行业板块主力净流入排名）→ 默认取前 N，可手工改勾/手输板块名
 *   ② 取板块成分股（按今日涨幅降序）→ 人工加/减股票（偏好跨批次继承）
 *   ③ 开始筛选 → 后台异步跑 Python（接口只调 1 次，不自动重试）→ 轮询进度
 *   ④ A 上升趋势票 / B 超跌反弹票两个 Tab；达标高亮、短板小字、红线淘汰折叠并写明触发哪一条
 *   ⑤ 点股票名进「具体分析」页（日 K + 分时 + 逐项得分）；点结果行也能看批次里的详情弹窗
 *   ⑥ 页面底部常驻「规则速览」，完整规则与全部可调数值在「规则与参数」面板里改
 *
 * 颜色遵循 frontend/COLOR_SCHEME.md：主色 #8B3A42，涨 #e74c3c / 跌 #27ae60
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Dialog, Empty, Input, Popup, SearchBar, Switch, Tabs, Tag, Toast } from 'antd-mobile'
import { moneyChaseApi, stockApi } from '../../services/api'
import CandidateDetail from './CandidateDetail'
import RulesPanel from './RulesPanel'
import SchedulePanel from './SchedulePanel'

const C = {
  primary: '#8B3A42', accent: '#C4737A', tag: '#F5E6E8', light: '#FAF0F1', track: '#E8CED1',
  up: '#e74c3c', down: '#27ae60', text: '#666',
}

const RUN_STATUS = {
  pending: { t: '准备中', c: '#999' },
  running: { t: '运行中', c: C.primary },
  completed: { t: '完成', c: C.primary },
  partial: { t: '部分完成', c: '#e67e22' },
  failed: { t: '失败', c: C.up },
}

const fmt = (v, n = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(n))
const pctCls = v => (v == null ? '#999' : v > 0 ? C.up : v < 0 ? C.down : '#999')

// 点股票名 → 单票具体分析页（日K + 分时，走新浪数据源）
const stockLink = (navigate) => (s, e) => {
  e?.stopPropagation()
  const q = encodeURIComponent(s.sector || '人工自选')
  navigate(`/money-chase/stock/${s.symbol}?sector=${q}`, { state: { name: s.name } })
}

function PopupHeader({ title, onClose, extra }) {
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 2, background: '#fff',
      display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: `1px solid ${C.tag}`,
    }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.primary, flex: 1 }}>{title}</span>
      {extra}
      <span onClick={onClose} style={{ fontSize: 20, color: '#999', padding: '0 6px', cursor: 'pointer' }}>×</span>
    </div>
  )
}

export default function MoneyChase() {
  const navigate = useNavigate()
  const [sectors, setSectors] = useState([])
  const [picked, setPicked] = useState([])
  const [sectorMeta, setSectorMeta] = useState({})
  const [manualSectorInput, setManualSectorInput] = useState('')
  const [loadingSectors, setLoadingSectors] = useState(false)

  const [cands, setCands] = useState(null)
  const [loadingCands, setLoadingCands] = useState(false)
  const [prefs, setPrefs] = useState([])
  const [kw, setKw] = useState('')
  const [stockHits, setStockHits] = useState([])

  const [runs, setRuns] = useState([])
  const [runId, setRunId] = useState(null)
  const [run, setRun] = useState(null)
  const [result, setResult] = useState([])
  const [highlight, setHighlight] = useState({ A: 7, B: 6 })
  // 每只票的最新打分摘要（含加入后自动打的分），只查后端数据库，不会多请求外部接口
  const [scores, setScores] = useState({})
  const [scoreTick, setScoreTick] = useState(0)
  const [pool, setPool] = useState('A')
  const [showEliminated, setShowEliminated] = useState(false)

  const [detail, setDetail] = useState(null)
  const [panel, setPanel] = useState(null)
  const [rules, setRules] = useState(null)
  const [errInfo, setErrInfo] = useState(null)
  const pollRef = useRef(null)

  // ==================== 初始化 ====================

  const loadRules = useCallback(() => {
    return moneyChaseApi.getRules()
      .then(res => { if (res.ok) setRules(res.data); return res.data })
      .catch(() => null)
  }, [])

  const loadPrefs = useCallback(() => {
    return moneyChaseApi.getManualStocks().then(res => setPrefs(res.data || [])).catch(() => null)
  }, [])

  const loadResult = useCallback(async (id) => {
    if (!id) return
    const res = await moneyChaseApi.getCandidates(id)
    if (res.ok) {
      setResult(res.data || [])
      setHighlight(h => ({ ...h, ...(res.highlight || {}) }))
    } else {
      Toast.show({ content: res.error || '读取候选结果失败', icon: 'fail' })
    }
  }, [])

  const loadRuns = useCallback(async () => {
    try {
      const res = await moneyChaseApi.listRuns({ limit: 20 })
      const list = res.data || []
      setRuns(list)
      const running = list.find(r => r.status === 'running')
      if (running) {
        setRunId(running.id)
        return
      }
      const last = list.find(r => r.status !== 'pending')
      if (last && !runId) setRunId(last.id)
    } catch (e) { /* 首次进入无批次属正常 */ }
  }, [runId])

  useEffect(() => {
    loadRules()
    loadPrefs()
    loadRuns()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 规则里的默认板块数（改了参数文档/页面数值即跟着变）
  const topSectors = useMemo(() => {
    const row = (rules?.flat || []).find(r => r.key === 'param:top_sectors')
    return Number(row?.value) || 3
  }, [rules])

  // ==================== ① 板块资金流 ====================

  const refreshSectors = async () => {
    setLoadingSectors(true)
    try {
      const res = await moneyChaseApi.getSectors()
      if (!res.ok) {
        setErrInfo({ title: '板块资金流获取失败', error: res.error, detail: res.errorDetail, retry: refreshSectors })
        return
      }
      const list = res.data.sectors || []
      setSectors(list)
      setSectorMeta({ trade_date: res.data.trade_date, run_time: res.data.run_time, intraday: res.data.intraday, all_count: res.data.all_count })
      setPicked(list.slice(0, topSectors).map(s => s.name))
      Toast.show({ content: `已取到 ${list.length} 个板块（共 ${res.data.all_count} 个行业）`, icon: 'success' })
    } catch {
      setErrInfo({ title: '板块资金流请求失败', error: '后端接口请求失败（可能超时），可稍后点重试', retry: refreshSectors })
    } finally {
      setLoadingSectors(false)
    }
  }

  const addManualSector = () => {
    const name = manualSectorInput.trim()
    if (!name) return
    if (sectors.some(s => s.name === name)) {
      setPicked(p => (p.includes(name) ? p : [...p, name]))
    } else {
      setSectors(prev => [...prev, { name, manual: true }])
      setPicked(prev => [...prev, name])
    }
    setManualSectorInput('')
    Toast.show({ content: `${name} 已加入并勾选（东财排名里没有该板块时，成分股会尝试模糊匹配）` })
  }

  // ==================== ② 成分股 / 人工加减 ====================

  const loadConstituents = async (names = picked) => {
    if (!names.length) { Toast.show({ content: '先勾选至少 1 个板块', icon: 'fail' }); return }
    setLoadingCands(true)
    try {
      const res = await moneyChaseApi.getConstituents(names)
      if (!res.ok) {
        setErrInfo({ title: '板块成分股获取失败', error: res.error, detail: res.errorDetail, retry: () => loadConstituents(names) })
        return
      }
      setCands(res.data)
      await loadPrefs()
      const bad = (res.data.boards || []).filter(b => b.error)
      if (bad.length) Toast.show({ content: `${bad.map(b => b.sector).join('、')} 未取到成分股`, icon: 'fail' })
    } catch {
      setErrInfo({ title: '板块成分股请求失败', error: '后端接口请求失败（可能超时），可稍后点重试', retry: () => loadConstituents(names) })
    } finally {
      setLoadingCands(false)
    }
  }

  const adjustStocks = async (payload, tip) => {
    const res = await moneyChaseApi.adjustManualStocks(payload)
    if (res.ok) {
      setPrefs(res.data || [])
      Toast.show({ content: tip })
      if (cands) loadConstituents(picked)
      // 加入时后端在后台自动跑单票分析（每只 3 次新浪请求），几秒后把分数拉回来
      if ((payload.add || []).length) setTimeout(() => setScoreTick(t => t + 1), 6000)
    } else {
      Toast.show({ content: res.error || '操作失败', icon: 'fail' })
    }
  }

  const searchStock = async (v) => {
    setKw(v)
    if (!v || v.trim().length < 2) { setStockHits([]); return }
    try {
      const res = await stockApi.getList({ search: v.trim(), pageSize: 10 })
      setStockHits((res.data || []).map(s => ({ symbol: s.code, name: s.name })))
    } catch {
      setStockHits([])
    }
  }

  // ==================== ③ 开始筛选 + 进度轮询 ====================

  const startRun = async () => {
    // 候选来源优先级：页面确认过的成分股清单 > 勾了板块（后台自动拉成分股） > 只有人工自选清单
    let symbols = cands?.finalSymbols?.length ? cands.finalSymbols : null
    let manualOnly = false
    if (!symbols && !picked.length && manualRows.some(m => m.added)) {
      symbols = manualRows.filter(m => m.added).map(m => `${m.symbol}:${m.sector || '人工自选'}`)
      manualOnly = true
    }
    if (!picked.length && !symbols) {
      Toast.show({ content: '先勾选板块，或在上面搜索框人工加入至少 1 只股票', icon: 'fail' })
      return
    }
    if (manualOnly) {
      Toast.show({ content: `只对这 ${symbols.length} 只人工自选股打分（不取板块成分股，板块相关项按数据缺失计）` })
    } else if (!cands && picked.length) {
      Toast.show({ content: '未取成分股，本次将按板块自动拉取全部成分股打分' })
    }
    const res = await moneyChaseApi.run({ sectors: picked, symbols })
    if (!res.ok) {
      setErrInfo({ title: '无法启动筛选', error: res.error, detail: res.errorDetail, retry: startRun })
      return
    }
    Toast.show({
      content: res.data.pending
        ? `批次 #${res.data.runId} 已启动：先抓板块成分股，进度实时刷新`
        : `批次 #${res.data.runId} 已启动（候选 ${res.data.candidateTotal} 只）`,
      icon: 'success',
    })
    setRunId(res.data.runId)
    setCands(null)
    loadRuns()
  }

  useEffect(() => {
    if (!runId) return
    let alive = true
    const tick = async () => {
      if (!alive) return
      try {
        const res = await moneyChaseApi.getRunStatus(runId)
        if (!res.ok) {
          setErrInfo({ title: '批次状态读取失败', error: res.error, retry: () => tick() })
          return
        }
        const st = res.data
        setRun(st)
        if (st.status === 'running' || st.status === 'pending') {
          pollRef.current = setTimeout(tick, 2000)
          return
        }
        if (st.status === 'failed') {
          setErrInfo({
            title: `批次 #${st.id} 失败`,
            error: st.error_msg || '脚本执行失败',
            detail: st.error_detail,
            retry: () => { setErrInfo(null); startRun() },
          })
        } else {
          Toast.show({ content: `批次 #${st.id} 完成，候选 ${st.stats.candidate_total} 只`, icon: 'success' })
        }
        loadRuns()
        loadResult(st.id)
      } catch {
        pollRef.current = setTimeout(tick, 3000)
      }
    }
    tick()
    return () => { alive = false; clearTimeout(pollRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const switchRun = (id) => {
    setRunId(id)
    setResult([])
  }

  // ==================== 结果分组 ====================

  const poolRows = useMemo(() => result.filter(r => r.pool_type === pool), [result, pool])
  const alive = useMemo(() => poolRows.filter(r => !r.eliminated), [poolRows])
  const dead = useMemo(() => poolRows.filter(r => r.eliminated), [poolRows])
  const counts = useMemo(() => ({
    A: result.filter(r => r.pool_type === 'A').length,
    B: result.filter(r => r.pool_type === 'B').length,
    qualified: result.filter(r => r.qualified).length,
    eliminated: result.filter(r => r.eliminated).length,
  }), [result])

  const removedSet = useMemo(() => new Set(prefs.filter(p => p.op_type === 'remove').map(p => p.symbol)), [prefs])
  const addedSet = useMemo(() => new Set(prefs.filter(p => p.op_type === 'add').map(p => p.symbol)), [prefs])

  // 人工清单自身（不依赖板块接口）：加入的都列出来，被剔除的也列出来给「恢复」入口
  const manualRows = useMemo(() => {
    const adds = prefs.filter(p => p.op_type === 'add' && !removedSet.has(p.symbol))
      .map(p => ({ symbol: p.symbol, name: p.name, sector: p.sector || '人工自选', added: true }))
    const dels = prefs.filter(p => p.op_type === 'remove')
      .map(p => ({ symbol: p.symbol, name: p.name, sector: p.sector || '人工自选', rejected: true }))
    return [...adds, ...dels]
  }, [prefs, removedSet])

  const candidateList = useMemo(() => {
    // 板块接口不可用 / 还没取成分股时，人工加入的股票也必须看得见（否则加完就“消失”）
    if (!cands) return manualRows
    const list = (cands.stocks || []).filter(s => !removedSet.has(s.symbol))
    const manual = (cands.manualAdded || []).filter(m => !list.some(s => s.symbol === m.symbol))
    const extra = (cands.stocks || []).filter(s => removedSet.has(s.symbol))
    return [...list, ...manual.map(m => ({ ...m, sector: m.sector || '人工自选', added: true })), ...extra.map(s => ({ ...s, rejected: true }))]
  }, [cands, removedSet, manualRows])

  // 清单里每只票的分数：后端自动打分（加入时 / 进分析页时）落库后在这里显出来
  const scoreKey = useMemo(() => candidateList.map(s => s.symbol).filter(Boolean).join(','), [candidateList])
  useEffect(() => {
    const list = scoreKey ? scoreKey.split(',') : []
    if (!list.length) { setScores({}); return }
    let alive = true
    moneyChaseApi.getLatestScores(list)
      .then(res => { if (alive && res.ok) setScores(res.data || {}) })
      .catch(() => {})
    return () => { alive = false }
  }, [scoreKey, scoreTick])

  // 红线速览（页面常驻展示，完整内容在规则面板）
  const redlineRows = useMemo(() => (rules?.flat || []).filter(r => r.category === 'redline'), [rules])
  const ruleText = key => (rules?.flat || []).find(r => r.key === key)?.description || ''

  // ==================== 渲染 ====================

  const goStock = stockLink(navigate)

  const sectorRow = (s) => {
    const on = picked.includes(s.name)
    return (
      <div
        key={s.name}
        onClick={() => setPicked(p => (on ? p.filter(x => x !== s.name) : [...p, s.name]))}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px', marginBottom: 4,
          background: on ? C.light : '#fff', border: `1px solid ${on ? C.accent : '#eee'}`, borderRadius: 8, cursor: 'pointer',
        }}
      >
        <span style={{ width: 16, color: on ? C.primary : '#bbb', fontWeight: 700 }}>{on ? '☑' : '☐'}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>
            {s.name}
            {s.manual ? <span style={{ fontSize: 10, color: C.accent, marginLeft: 4 }}>手工添加</span> : null}
          </div>
          <div style={{ fontSize: 10, color: '#999' }}>
            {s.net_inflow_yi == null ? '东财排名内未找到该板块资金流数值（成分股仍会尝试拉取）' : `今日主力净流入 ${fmt(s.net_inflow_yi)} 亿　净占比 ${fmt(s.net_inflow_pct, 1)}%`}
            {s.avg_5d_yi != null ? `　近5日均 ${fmt(s.avg_5d_yi)} 亿` : ''}
          </div>
        </div>
        {s.ebb != null && (
          <Tag style={{ '--background': s.ebb ? '#f5f5f5' : C.tag, '--color': s.ebb ? '#999' : C.primary, fontSize: 9 }} fill="outline">
            {s.ebb ? '退潮' : '未退潮'}
          </Tag>
        )}
        <span style={{ fontSize: 12, fontWeight: 600, color: pctCls(s.pct_change), width: 52, textAlign: 'right' }}>
          {s.pct_change == null ? '—' : `${s.pct_change > 0 ? '+' : ''}${fmt(s.pct_change)}%`}
        </span>
      </div>
    )
  }

  const candidateRow = (s) => {
    const rejected = removedSet.has(s.symbol)
    // 成分股没取到时，人工加入的票只有代码/名称，行情栏位要写成“未取到”而不是 ¥0 / 0 亿
    const hasQuote = s.price != null || s.today_pct != null || s.amount_yi != null
    const sc = scores[s.symbol]
    const th = sc ? (highlight[sc.pool_type] ?? 99) : null
    return (
      <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid #f5f5f5', opacity: rejected ? 0.5 : 1 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: pctCls(s.today_pct), width: 54, textAlign: 'right' }}>
          {s.today_pct == null ? '—' : `${s.today_pct > 0 ? '+' : ''}${fmt(s.today_pct)}%`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            <span onClick={e => goStock(s, e)} style={{ color: C.primary, textDecoration: 'underline' }}>{s.name}</span>
            <span style={{ fontSize: 10, color: '#999', fontWeight: 400 }}> {s.symbol}</span>
            <span style={{ fontSize: 9, color: '#bbb', marginLeft: 4 }}>点名字看具体分析/日K</span>
            {s.added ? <span style={{ fontSize: 9, color: C.primary, marginLeft: 4 }}>人工加入</span> : null}
            {rejected ? <span style={{ fontSize: 9, color: '#999', marginLeft: 4 }}>已人工剔除</span> : null}
          </div>
          <div style={{ fontSize: 10, color: '#999' }}>
            {hasQuote ? (
              <>
                {s.sector}　¥{fmt(s.price)}　额 {fmt(s.amount_yi)} 亿　换手 {fmt(s.turnover)}%
                {s.vol_ratio != null ? `　量比 ${fmt(s.vol_ratio)}` : ''}
                {s.board && s.board !== '主板' ? `　${s.board}` : ''}
              </>
            ) : `${s.sector}　未取到实时行情（板块接口不可用时的正常状态），打分时会自动补抓`}
          </div>
          {/* 加入后后台会自动跑单票分析，分数直接回到这份清单，不必再点“开始筛选打分” */}
          {sc ? (
            <div style={{ fontSize: 10, marginTop: 2, color: sc.eliminated ? '#999' : C.primary }}>
              已打分 {sc.total_score}/{th}（{sc.pool_type} 池　自动 {sc.auto_score}/{sc.max_auto_score}　人工 {sc.manual_score}）
              {sc.eliminated ? '　🚫已淘汰' : sc.picked ? '　★已选中' : ''}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>尚未打分：点名字进分析页会自动打分，加入时也会在后台自动打</div>
          )}
        </div>
        <Button
          size="mini"
          fill={rejected ? 'outline' : 'none'}
          color={rejected ? 'primary' : 'default'}
          onClick={() => adjustStocks(rejected ? { unreject: [{ symbol: s.symbol }] } : { remove: [{ symbol: s.symbol, name: s.name, sector: s.sector }] }, rejected ? '已恢复该股票' : '已剔除该股票（下次运行仍生效）')}
        >
          {rejected ? '恢复' : '剔除'}
        </Button>
      </div>
    )
  }

  const resultRow = (r) => {
    const threshold = highlight[r.pool_type] ?? 99
    const strong = r.qualified
    return (
      <div
        key={r.id}
        onClick={() => setDetail(r)}
        style={{
          padding: '8px 10px', marginBottom: 6, borderRadius: 8, cursor: 'pointer',
          background: strong ? C.light : '#fff',
          border: `1px solid ${strong ? C.accent : '#eee'}`,
          borderLeft: `3px solid ${r.eliminated ? '#ddd' : strong ? C.primary : '#eee'}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span onClick={e => goStock(r, e)} style={{ fontSize: 14, fontWeight: 700, color: C.primary, textDecoration: 'underline' }}>{r.name}</span>
          <span style={{ fontSize: 10, color: '#999' }}>{r.symbol}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: pctCls(r.today_pct) }}>
            {r.today_pct == null ? '—' : `${r.today_pct > 0 ? '+' : ''}${fmt(r.today_pct)}%`}
          </span>
          <span style={{ fontSize: 10, color: '#999', flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{r.sector}</span>
          <span style={{ fontSize: 15, fontWeight: 700, color: r.eliminated ? '#999' : C.primary }}>
            {r.total_score}
            <span style={{ fontSize: 10, color: '#999', fontWeight: 400 }}>/{threshold}达标</span>
          </span>
        </div>

        <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>
          自动 {r.auto_score}/{r.max_auto_score}　人工 {r.manual_score}
          {r.indicators?.dow ? `　道氏${{ UP: '上升', DOWN: '下降', SHAKE: '震荡' }[r.indicators.dow] || '—'}` : ''}
          {r.indicators?.vol_ratio_est != null ? `　折算量比 ${fmt(r.indicators.vol_ratio_est)}倍` : ''}
          {r.picked ? '　★已选中' : ''}
        </div>

        {/* 短板小字 */}
        {!r.eliminated && !strong && (
          <div style={{ fontSize: 10, color: C.accent, marginTop: 3, lineHeight: 1.5 }}>
            短板：{r.weakest_gap || '总分未达门槛'}
          </div>
        )}
        {!r.eliminated && strong && (
          <div style={{ fontSize: 10, color: C.primary, marginTop: 3 }}>
            ✓ 达标候选　建议持仓：{r.suggest_hold}
          </div>
        )}

        {/* 红线：写清触发哪一条 + 数值 */}
        {r.eliminated && (
          <div style={{ marginTop: 4 }}>
            {(r.red_lines || []).map(x => (
              <div key={x.code} style={{ fontSize: 10, color: C.up, lineHeight: 1.5 }}>
                🚫 红线 {x.code}｜{x.label}
                <span style={{ color: '#999' }}>（{x.mode === 'semi' ? '脚本预警+人工确认' : '自动判定'}）</span>
                　{x.detail}
              </div>
            ))}
            {r.elim_source === 'manual' && <div style={{ fontSize: 10, color: '#999' }}>人工判定淘汰</div>}
            {(r.red_lines || []).length === 0 && r.elim_source !== 'manual' && (
              <div style={{ fontSize: 10, color: C.up }}>已淘汰</div>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="page-container" style={{ '--adm-color-primary': C.primary }}>
      {/* ===== 顶部：批次与运行 ===== */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.primary }}>每日追资金</div>
            <div style={{ fontSize: 10, color: '#999', marginTop: 2, lineHeight: 1.5 }}>
              资金流入板块 → 板块内候选 → 日线打分分流 A/B
              {run ? `　·　批次 #${run.id} ${run.trade_date} ${run.run_time}` : ''}
              {run?.intraday ? `（盘中·已交易 ${run.elapsed_trading_min ?? '—'} 分钟，量能折算×${fmt(run.vol_scale)}）` : ''}
            </div>
          </div>
          <Button size="small" fill="outline" onClick={() => setPanel('schedules')}>定时</Button>
          <Button size="small" color="primary" onClick={() => setPanel('rules')}>规则与参数</Button>
        </div>

        {/* 运行进度（pending = 后台还在抓板块/成分股，同样要显阶段） */}
        {run && (run.status === 'running' || run.status === 'pending') && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: C.text, marginBottom: 4 }}>
              <span>{run.stage || '进行中'}…（接口只调 1 次，不自动重试）</span>
              <span>{run.progress || 0}%</span>
            </div>
            <div style={{ height: 6, background: C.track, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${run.progress || 0}%`, height: '100%', background: `linear-gradient(90deg, ${C.primary}, #C27078)`, transition: 'width .4s' }} />
            </div>
          </div>
        )}

        {/* 批次摘要 */}
        {run && run.status !== 'running' && run.status !== 'pending' && (
          <div style={{ marginTop: 10, background: C.light, borderRadius: 8, padding: 8, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
            <div>
              <Tag style={{ '--background': '#fff', '--color': RUN_STATUS[run.status]?.c, fontSize: 10 }} fill="outline">
                {RUN_STATUS[run.status]?.t || run.status}
              </Tag>
              {' '}候选 {run.stats?.candidate_total ?? '—'} 只　达标 {counts.qualified} 只　红线淘汰 {run.stats?.eliminated ?? '—'} 只　跳过 {run.stats?.skipped ?? '—'} 只
              {run.stats?.failed ? `　失败 ${run.stats.failed} 次` : ''}
            </div>
            <div style={{ fontSize: 10, color: '#999' }}>
              板块：{(Array.isArray(run.sectors) ? run.sectors.map(s => s.name || s).join('、') : '—') || '—'}
              　数据截至 {run.data_as_of || '—'}　已交易 {run.elapsed_trading_min ?? '—'} 分钟
            </div>
            {run.error_msg && <div style={{ color: C.up, fontSize: 11, marginTop: 2 }}>失败原因：{run.error_msg}</div>}
            {(run.warnings || []).length > 0 && (
              <div style={{ color: '#b7791f', fontSize: 10, marginTop: 2, lineHeight: 1.5 }}>
                {(run.warnings || []).map((w, i) => <div key={i}>⚠️ {w}</div>)}
              </div>
            )}
          </div>
        )}

        {/* 历史批次 */}
        {runs.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginTop: 8, overflowX: 'auto', paddingBottom: 2 }}>
            {runs.slice(0, 12).map(r => (
              <span
                key={r.id}
                onClick={() => switchRun(r.id)}
                style={{
                  fontSize: 10, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap', cursor: 'pointer',
                  background: r.id === runId ? C.tag : '#f7f7f7',
                  color: r.id === runId ? C.primary : (RUN_STATUS[r.status]?.c || '#999'),
                  border: `1px solid ${r.id === runId ? C.accent : '#eee'}`,
                }}
              >
                #{r.id} {r.run_time}{r.sector_source === 'manual_input' ? ' 单票自动' : ''}{r.status === 'failed' ? ' 失败' : ''}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <Button block size="small" fill="outline" loading={loadingSectors} onClick={refreshSectors}>刷新板块资金流</Button>
          <Button block size="small" fill="outline" loading={loadingCands} onClick={() => loadConstituents()}>取板块成分股</Button>
          <Button block size="small" color="primary" disabled={run?.status === 'running' || run?.status === 'pending'} onClick={startRun}>开始筛选打分</Button>
        </div>
      </Card>

      {/* ===== ① 板块资金流 ===== */}
      <Card title="① 资金流入板块" extra={<span style={{ fontSize: 10, color: '#999' }}>{sectorMeta.trade_date || ''} {sectorMeta.run_time || ''}</span>}>
        <div style={{ fontSize: 10, color: '#999', marginBottom: 6, lineHeight: 1.5 }}>
          东财行业板块主力净流入排名（前 {sectors.length || '—'} 个展示，默认勾选前 {topSectors} 个）。
          与你同花顺所见不一致时，可直接改勾或手输板块名。
        </div>
        {sectors.length === 0 ? (
          <Empty description="还没有取板块数据，点上方「刷新板块资金流」" />
        ) : (
          <div style={{ maxHeight: 250, overflowY: 'auto' }}>{sectors.map(sectorRow)}</div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Input value={manualSectorInput} onChange={setManualSectorInput} placeholder="手输板块名（如：人形机器人）" style={{ '--font-size': '12px', flex: 1 }} />
          <Button size="mini" fill="outline" onClick={addManualSector}>添加板块</Button>
        </div>
      </Card>

      {/* ===== ② 候选股确认 ===== */}
      <Card title={`② 候选股确认${cands ? `（成分 ${cands.stocks?.length || 0} · 最终送打分 ${cands.finalCount}）` : ''}`}>
        <SearchBar placeholder="搜索股票名称/代码，人工加入候选" value={kw} onChange={searchStock} style={{ '--background': '#f5f5f5' }} />
        {kw.trim().length >= 2 && (
          <div style={{ marginTop: 6 }}>
            {stockHits.length === 0 ? (
              <div style={{ fontSize: 11, color: '#999', padding: 6 }}>本地股票库里没有匹配项</div>
            ) : stockHits.map(s => (
              <div key={s.symbol} style={{ display: 'flex', alignItems: 'center', padding: '5px 8px', borderBottom: '1px solid #f5f5f5' }}>
                <span style={{ fontSize: 12, flex: 1 }}>{s.name} <span style={{ color: '#999', fontSize: 10 }}>{s.symbol}</span></span>
                <Button
                  size="mini" fill="outline" color="primary"
                  disabled={addedSet.has(s.symbol)}
                  onClick={() => adjustStocks({ add: [{ symbol: s.symbol, name: s.name, sector: '人工自选' }] }, addedSet.has(s.symbol) ? '已在清单里' : `已加入 ${s.name}，后台正在自动打分（新浪 3 次请求、不重试）`)}
                >
                  {addedSet.has(s.symbol) ? '已加入' : '加入候选'}
                </Button>
              </div>
            ))}
          </div>
        )}

        {!cands && (
          <div style={{ fontSize: 11, color: '#999', marginTop: 8, lineHeight: 1.6 }}>
            选好板块后点「取板块成分股」，这里会按今日涨幅从高到低列出，并可逐个剔除。
            人工加/减的偏好会一直保留，之后每次（含定时）运行都自动套用。
            {manualRows.length > 0
              ? <>　当前人工清单已逐只列在下方（<strong style={{ color: C.primary }}>不依赖板块接口</strong>）：板块接口取不到时，直接点「开始筛选打分」就只对这份清单打分。</>
              : ''}
          </div>
        )}
        {cands && (cands.unmatched || []).length > 0 && (
          <div style={{ background: '#FFF8E6', borderRadius: 8, padding: 8, fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
            <strong style={{ color: '#b7791f' }}>板块名没对上东财行业板块</strong>
            {cands.unmatched.map(u => (
              <div key={u.input}>
                「{u.input}」
                {u.suggestions?.length ? <>　相近的板块：{u.suggestions.map(x => (
                  <span key={x} style={{ color: C.primary, marginLeft: 4, textDecoration: 'underline' }} onClick={() => setPicked(p => [...p, x])}>{x}</span>
                ))}</> : <>　无相近项，请检查名称</>}
              </div>
            ))}
          </div>
        )}
        {/* 清单常驻：成分股取不到时至少看得见人工加入/剔除的票 */}
        <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 8 }}>
          {candidateList.length === 0
            ? <Empty description={cands ? '该板块组合没有成分股（或被全部剔除）' : '人工清单为空：用上方搜索框加入股票'} />
            : candidateList.map(candidateRow)}
        </div>
        {cands && (
          <div style={{ fontSize: 10, color: '#999', marginTop: 6 }}>
            送打分清单 {cands.finalCount} 只（超过 max_candidates_per_run 会按涨幅截断）。确认后点「开始筛选打分」。
          </div>
        )}
      </Card>

      {/* ===== ③ 打分结果 ===== */}
      {result.length > 0 && (
        <Card title="③ 打分结果（按今日涨幅降序）" extra={<span style={{ fontSize: 10, color: '#999' }}>达标 {counts.qualified} / 淘汰 {counts.eliminated}</span>}>
          <Tabs activeKey={pool} onChange={setPool}>
            <Tabs.Tab key="A" title={`A 上升趋势 ${counts.A}`} />
            <Tabs.Tab key="B" title={`B 超跌反弹 ${counts.B}`} />
          </Tabs>

          <div style={{ fontSize: 10, color: '#999', margin: '6px 0 8px', lineHeight: 1.5 }}>
            {pool === 'A' ? ruleText('pool:A') : ruleText('pool:B')}
          </div>

          {/* 单票分析自动落的打分记录也是一个批次行，跟板块筛选结果区分开 */}
          {run?.sector_source === 'manual_input' && (
            <div style={{ fontSize: 10, color: C.primary, background: C.light, borderRadius: 8, padding: 8, marginBottom: 8, lineHeight: 1.6 }}>
              这里是「加入候选 / 点股票名」时自动打分的记录（每只只请求新浪 3 次），不是板块筛选批次。
              想看筛选结果就点上方其它批次；要整批打分仍然用顶部「开始筛选打分」。
            </div>
          )}

          {alive.map(resultRow)}

          {dead.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div
                onClick={() => setShowEliminated(v => !v)}
                style={{ fontSize: 11, color: '#999', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              >
                <span style={{ flex: 1 }}>🚫 红线淘汰 {dead.length} 只（触发任意一条即出局，点开看触发了哪一条）</span>
                <Switch checked={showEliminated} style={{ '--height': '18px', '--width': '36px' }} onChange={setShowEliminated} />
              </div>
              {showEliminated && <div style={{ marginTop: 8 }}>{dead.map(resultRow)}</div>}
            </div>
          )}

          {run?.skip_list?.length > 0 && (
            <div style={{ marginTop: 10, background: '#fafafa', borderRadius: 8, padding: 8, fontSize: 10, color: '#999', maxHeight: 120, overflowY: 'auto' }}>
              <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>本次未打分 {run.skip_list.length} 只（接口失败 / 条件不满足）</div>
              {run.skip_list.map((s, i) => (
                <div key={i}>{s.symbol} <span onClick={e => goStock(s, e)} style={{ color: C.primary, textDecoration: 'underline' }}>{s.name || '看分析'}</span>：{s.reason}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ===== 未打分明细（接口失败 / 条件不满足都列在这里：即使一只都没打分成功，也要看得见“它怎么了”） ===== */}
      {run && (run.status === 'completed' || run.status === 'partial') && result.length === 0 && (
        <Card title="本次没有产出打分结果">
          <div style={{ fontSize: 11, color: '#999', lineHeight: 1.6 }}>
            批次 #{run.id} 送打分 {run.stats?.candidate_total ?? 0} 只，但没有任何一只完成打分（失败 {run.stats?.failed ?? 0} 次）。具体原因逐只列在下面，可稍后直接重试。
          </div>
          {(run.skip_list || []).length > 0 && (
            <div style={{ marginTop: 8, background: '#fafafa', borderRadius: 8, padding: 8, fontSize: 10, color: '#999', maxHeight: 160, overflowY: 'auto' }}>
              <div style={{ fontWeight: 600, color: C.text, marginBottom: 4 }}>未打分 {run.skip_list.length} 只</div>
              {run.skip_list.map((s, i) => (
                <div key={i}>{s.symbol} <span onClick={e => goStock(s, e)} style={{ color: C.primary, textDecoration: 'underline' }}>{s.name || '看分析'}</span>：{s.reason}</div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ===== 规则速览（常驻展示） ===== */}
      <Card title="判定规则速览" extra={<span style={{ fontSize: 11, color: C.primary }} onClick={() => setPanel('rules')}>完整规则与参数 →</span>}>
        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>{ruleText('text:positioning')}</div>
        <div style={{ fontSize: 11, color: C.primary, fontWeight: 600, marginBottom: 4 }}>总分公式</div>
        <div style={{ fontSize: 11, color: C.text, lineHeight: 1.6, marginBottom: 8 }}>{ruleText('text:score_formula')}</div>

        <div style={{ fontSize: 11, fontWeight: 700, color: C.up, marginBottom: 4 }}>
          红线清单（A 池 {redlineRows.filter(r => r.pool === 'A').length} 条 / B 池 {redlineRows.filter(r => r.pool === 'B').length} 条，触发任意一条直接淘汰）
        </div>
        {['A', 'B'].map(p => (
          <div key={p} style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: C.primary, marginBottom: 2 }}>{p} 池</div>
            {redlineRows.filter(r => r.pool === p).map(r => (
              <div key={r.key} style={{ fontSize: 11, color: r.enabled === false ? '#bbb' : C.text, lineHeight: 1.6 }}>
                <span style={{ color: r.enabled === false ? '#bbb' : C.up }}>{r.code}</span>
                <span style={{ textDecoration: r.enabled === false ? 'line-through' : 'none' }}>　{r.label}</span>
                <span style={{ color: '#999', fontSize: 10 }}>（{r.mode === 'auto' ? '自动判定' : r.mode === 'semi' ? '预警+人工确认' : '人工'}{r.enabled === false ? '，已停用' : ''}）</span>
              </div>
            ))}
          </div>
        ))}
        <div style={{ fontSize: 10, color: '#999', lineHeight: 1.6, marginTop: 6 }}>
          每条判定的具体公式、阈值数值、人工复核项都在「规则与参数」里全文列出，数值可在页面直接改；
          改 backend/config/money_chase_rules.json 后点「从文件重新同步」也一样生效。
        </div>
      </Card>

      {/* ===== 边界声明 ===== */}
      <div style={{ fontSize: 10, color: '#bbb', lineHeight: 1.6, padding: '4px 6px 20px' }}>{ruleText('text:boundary')}</div>

      {/* ===== 详情 Popup ===== */}
      <Popup visible={!!detail} onMaskClick={() => setDetail(null)} position="bottom" bodyStyle={{ height: '92vh', borderTopLeftRadius: 14, borderTopRightRadius: 14, overflowY: 'auto' }}>
        {detail && (
          <>
            <PopupHeader title={`候选详情 · ${detail.name}`} onClose={() => setDetail(null)} />
            <CandidateDetail item={detail} onClose={() => setDetail(null)} />
          </>
        )}
      </Popup>

      {/* ===== 规则面板 Popup ===== */}
      <Popup visible={panel === 'rules'} onMaskClick={() => setPanel(null)} position="bottom" bodyStyle={{ height: '92vh', borderTopLeftRadius: 14, borderTopRightRadius: 14, overflowY: 'auto', padding: '0 12px' }}>
        {panel === 'rules' && (
          <>
            <PopupHeader title="规则与参数总表" onClose={() => setPanel(null)} />
            {rules ? <RulesPanel rules={rules} onChanged={loadRules} /> : <Empty description="规则未加载，请检查后端是否已启动" />}
          </>
        )}
      </Popup>

      {/* ===== 定时面板 Popup ===== */}
      <Popup visible={panel === 'schedules'} onMaskClick={() => setPanel(null)} position="bottom" bodyStyle={{ height: '80vh', borderTopLeftRadius: 14, borderTopRightRadius: 14, overflowY: 'auto', padding: '0 12px' }}>
        {panel === 'schedules' && (
          <>
            <PopupHeader title="定时筛选节点" onClose={() => setPanel(null)} />
            <SchedulePanel onChanged={(newRunId) => { if (newRunId) setRunId(newRunId); loadRuns() }} />
          </>
        )}
      </Popup>

      {/* ===== 失败弹窗（人工决定是否重试） ===== */}
      <Dialog
        visible={!!errInfo}
        title={errInfo?.title || '执行失败'}
        content={
          errInfo && (
            <div style={{ fontSize: 12, lineHeight: 1.6, maxHeight: 260, overflowY: 'auto' }}>
              <div style={{ color: '#333' }}>{errInfo.error}</div>
              {errInfo.detail && (
                <div style={{ fontSize: 10, color: '#999', marginTop: 6, wordBreak: 'break-all' }}>
                  技术细节：{String(errInfo.detail).slice(0, 600)}
                </div>
              )}
              <div style={{ fontSize: 10, color: '#999', marginTop: 6 }}>
                脚本不会自动重试（避免被数据源限流）。你可以过几分钟再点「重试」，或先改板块/参数再跑。
              </div>
            </div>
          )
        }
        closeOnAction
        actions={[[
          { key: 'close', text: '知道了' },
          { key: 'retry', text: '重试', primary: true, onClick: () => errInfo?.retry && errInfo.retry() },
        ]]}
        onClose={() => setErrInfo(null)}
      />
    </div>
  )
}
