/**
 * 胡胖胖招财进宝 —— 主页面（批量自动打分榜单）
 *
 * 用法：这里是你主观选好的股票清单；选定一个「时间点」（默认今天，可选历史交易日复盘），
 * 点「开始打分」→ 后端复用追资金指标流水线，算三个互相独立的基础分，再组合两套综合分：
 *  · A_score：买入分 = 【判定项配置】M1 道氏 / M2 葛兰碧 / M3 量价 / M4 均线 / M5 DMI / M6 斐波 / M7 箱体 / M8 蜡烛 加权
 *  · B_score：超跌反转分 B1～B7（默认整组关闭，需去「权重配置」打开；B7 只认筹码接口真实数据）
 *  · W_score：衰竭止盈分（A/B 共用，越高兑现风险越大）
 *  · S_A = A×wA − W×wB（趋势池排序）、S_B = B×wA − W×wB（反转池排序），钳位后平移为 0～100
 *
 * 两级打分：粗筛（≤batch_max_pre_filter 只，不请求筹码，B7 记 0）→ 精选（S_B 靠前 ≤select_max_chip 只，
 * 串行请求真实筹码接口补 B7 并覆盖落库，同时保留粗筛快照可对比）。
 *
 * 打分口径随时间点定格：历史日期用追资金 snapshot（收盘截断），当天用 live score。
 * 结果会落库，切换日期时优先读已存榜单（秒开、0 行情请求），需要更新再点「开始打分」。
 * 颜色遵循项目酒红色系（#8B3A42）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Dialog, Empty, Input, ProgressBar, TextArea, Toast } from 'antd-mobile'
import dayjs from 'dayjs'
import { fortuneApi, stockApi, calendarApi } from '../../services/api'
import CriteriaConfig from './CriteriaConfig'
import { C, fmt, todayStr } from './helpers'

// 迷你日历星期头（与首页一致：周日开头）
const WEEK = ['日', '一', '二', '三', '四', '五', '六']

// 模块徽标（表格里空间有限，只显简称 + 分数；完整名称/明细在详情页看）
const MODULE_SHORT = {
  dow: '道氏', granville: '葛兰碧', volume_price: '量价', ma: '均线',
  dmi: 'DMI', fib: '斐波', box: '箱体', candle: '蜡烛',
}
const shortName = (code, name) => MODULE_SHORT[code] || String(name || code).replace(/[（(].*$/, '').trim().slice(0, 3)
const scoreColor = s => (s == null ? '#ccc' : s >= 80 ? C.primary : s >= 60 ? C.accent : '#999')

// 综合分（S_A/S_B）取分：扫描行与落库行都存成 {score,raw,wA,wB} 或 null
const csVal = v => (v && v.score != null ? Number(v.score) : null)
// 本次打分属于哪一轮
const STAGE_LABEL = { pre_filter: '粗筛', select: '精选', history: '历史定格', single: '含筹码' }
// B7 筹码来源角标：真实接口 / 获取失败记 0 / 未请求
const CHIP_BADGE = {
  real_api: { text: '💰真', color: C.primary },
  failed: { text: '💰0', color: '#b3261e' },
  none: { text: '💰—', color: '#bbb' },
}

// 行内分数徽标（表格里空间有限，完整判定依据在详情页看）
function ScoreChip({ label, value, color, title, digits = 1 }) {
  return (
    <span title={title || ''} style={{ fontSize: 9, lineHeight: '14px', padding: '0 4px', borderRadius: 7, background: C.light, color: color || '#999', whiteSpace: 'nowrap' }}>
      {label} {value == null ? '—' : Number(value).toFixed(digits)}
    </span>
  )
}

// 把「扫描结果行」或「落库评估行」归一成表格行（模块列按配置顺序取前 3 个算出分的模块）
function toRow(r, bands, criteria) {
  const cs = r.criterion_scores || {}
  const bandCode = r.band?.code || r.band_code || ''
  const b = (bands || []).find(x => x.code === bandCode)
  const src = r.module_scores || {}
  const list = []
  for (const c of criteria || []) {
    if (c.type !== 'auto' || !c.enabled) continue
    const v = src[c.code] ?? cs[c.code]?.score ?? null
    if (v == null) continue
    list.push({ code: c.code, name: shortName(c.code, c.name), score: Number(v) })
  }
  // 衰竭 W：扫描行带 exhaustion（foldSellModules 全量），落库行带 exhaustion_total/band
  const exh = r.exhaustion || null
  const exhTotal = exh ? exh.total : (r.exhaustion_total == null ? null : Number(r.exhaustion_total))
  const exhBand = (exh && exh.band) || r.exhaustion_band || null
  // 反转 B：扫描行带 reversal（全量），落库行带 reversal_summary/reversal_total/band
  const rev = r.reversal || null
  const revSum = r.reversal_summary || null
  const bTotal = rev ? rev.total : (r.reversal_total == null ? null : Number(r.reversal_total))
  const bBand = (rev && rev.band) || r.reversal_band || (revSum && revSum.band) || null
  const chip = (rev && rev.chip) || r.chip || (revSum && revSum.chip) || null
  const comp = r.composite || revSum?.composite || null
  return {
    id: r.id ?? null,
    symbol: r.symbol,
    name: r.name || '',
    sector: r.sector || '',
    total: Number(r.weighted_total ?? r.total ?? 0),
    modules: list.slice(0, 3),
    moduleCount: list.length,
    trend_label: r.trend_label || '', pool_type: r.pool_type || '',
    ma_state_label: r.ma_state_label || cs.ma?.state_label || '',
    band: r.band || (b ? { code: b.code, label: r.band_label || b.label, color: b.color, advice: b.advice } : { code: bandCode, label: r.band_label || '', color: '#999', advice: '' }),
    data_as_of: r.data_as_of || r.eval_date || '',
    exhTotal, exhBand, exhUnavailable: !!(exh && exh.unavailable),
    // 三个基础分 + 两套综合分（null = 未判定：W 无数据 / B 组整组关闭）
    B: bTotal == null ? null : Number(bTotal), bBand, chip,
    SA: csVal(comp && comp.S_A != null ? comp.S_A : r.S_A),
    SB: csVal(comp && comp.S_B != null ? comp.S_B : r.S_B),
    wA: (comp && comp.wA) || (comp && comp.S_A && comp.S_A.wA) || 0.8,
    wB: (comp && comp.wB) || (comp && comp.S_A && comp.S_A.wB) || 0.2,
    run_stage: r.run_stage || '',
    oversold: rev ? !!rev.oversold : (revSum ? revSum.oversold === true : null),
    drawdown_pct: (rev && rev.drawdown_pct) ?? (revSum && revSum.drawdown_pct) ?? null,
    bDegraded: !!(rev && rev.degraded) || !!(revSum && revSum.degraded),
    bEnabled: bTotal != null,
  }
}

export default function Fortune() {
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [stocks, setStocks] = useState([])
  const [showConfig, setShowConfig] = useState(false)

  const [evalDate, setEvalDate] = useState(todayStr())
  // 时间点迷你日历（参照首页模式：收起只显选中日所在周行，展开看整月）
  // 圆点数据源 = 招财进宝自己的评分记录（fortune_evaluations），不跟首页大盘快照共用
  const [scoredDays, setScoredDays] = useState({})
  const [viewMonth, setViewMonth] = useState(dayjs())
  const [calCollapsed, setCalCollapsed] = useState(true)
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])
  // 榜单池子：all=全部票（默认，趋势+反转不分流）/ trend=趋势池（剔除反转票）/ reversal=反转池（只看超跌候选）/ mixed=混合观察池（两列对照）
  const [pool, setPool] = useState('all')
  // 榜单排序：S_A / S_B / A（买入分）/ B（反转分）/ W（衰竭分）；方向：desc 从大到小（默认）/ asc 点击同一按钮切换
  const [sortMode, setSortMode] = useState('S_A')
  const [sortDir, setSortDir] = useState('desc')

  // 榜单删除：delMode=勾选批量删除模式；delSel=已勾选代码集合
  const [delMode, setDelMode] = useState(false)
  const [delSel, setDelSel] = useState([])

  // 打分任务
  const [scanId, setScanId] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  // 精选筹码轮（串在同一次扫描里）的进度：chip_done/chip_total，chip_skipped 写明本轮为何未跑
  const [chipProg, setChipProg] = useState(null)
  const pollRef = useRef(null)

  // 单票打分串行队列（加入即逐只打分，不并行、不全量）
  const [scoreQ, setScoreQ] = useState([])
  const [scoringSym, setScoringSym] = useState(null)

  // 股票池搜索（接系统股票库）
  const [poolKw, setPoolKw] = useState('')
  const [poolHits, setPoolHits] = useState([])
  const [searching, setSearching] = useState(false)

  // 批量添加
  const [batchOpen, setBatchOpen] = useState(false)
  const [batchText, setBatchText] = useState('')
  const [batchSector, setBatchSector] = useState('')
  const [batchLoading, setBatchLoading] = useState(false)

  const loadDoc = useCallback(async () => {
    const res = await fortuneApi.getCriteria()
    if (res.ok) setDoc(res.data)
  }, [])
  const loadStocks = useCallback(async () => {
    const res = await fortuneApi.getStocks()
    if (res.ok) setStocks(res.data || [])
  }, [])

  useEffect(() => { loadDoc(); loadStocks() }, [loadDoc, loadStocks])

  // 读某时间点已落库榜单（秒开）
  const loadBoard = useCallback(async (date) => {
    const res = await fortuneApi.getLeaderboard(date)
    if (res.ok) {
      const d = (await fortuneApi.getCriteria()).data || {}
      setRows((res.data || []).map(r => toRow(r, d.bands || [], d.criteria || [])))
    }
  }, [])

  useEffect(() => { loadBoard(evalDate); setDelMode(false); setDelSel([]) }, [evalDate, loadBoard])

  // 拉「有评分记录」的日期清单（日历圆点）；失败不阻断页面，退回全淡色格子
  const loadScoredDays = useCallback(async () => {
    try {
      const res = await fortuneApi.getEvaluationDates()
      const list = Array.isArray(res?.data) ? res.data : []
      const map = {}
      for (const d of list) if (d && d.date) map[String(d.date).slice(0, 10)] = Number(d.count) || 0
      setScoredDays(map)
    } catch (e) { /* 接口异常 → 保持上一次圆点 */ }
  }, [])
  useEffect(() => { loadScoredDays() }, [loadScoredDays])

  // 交易日历缓存：'YYYY-MM' → Set(交易日 ISO) | null（null=该月无日历，退化按工作日近似）
  const tradingRef = useRef({})
  const [calVer, calBump] = useState(0)
  const loadCalMonth = useCallback(async (m) => {
    const k = m.format('YYYY-MM')
    if (tradingRef.current[k] !== undefined) return
    let set = null
    try {
      const res = await calendarApi.getMonth(m.year(), m.month() + 1)
      const list = Array.isArray(res) ? res : res?.data || []
      if (Array.isArray(list) && list.length) {
        set = new Set(list.filter(x => x.is_trading_day).map(x => String(x.trade_date).slice(0, 10)))
      }
    } catch (e) { /* 表未初始化等 → 保持 null 退化 */ }
    tradingRef.current[k] = set
    calBump(v => v + 1)   // 网格着色重渲染
  }, [])
  useEffect(() => { loadCalMonth(dayjs(evalDate)) }, [evalDate, loadCalMonth])
  useEffect(() => { if (!calCollapsed) loadCalMonth(viewMonth) }, [calCollapsed, viewMonth, loadCalMonth])

  // 左右按钮：逐格跳上一/下一交易日（含没数据的交易日，跳过去后可直接打分补录）；日历缺失时退化跳工作日
  const stepDay = async (dir) => {
    let d = dayjs(evalDate)
    for (let i = 0; i < 75; i++) {
      d = d.add(dir, 'day')
      if (tradingRef.current[d.format('YYYY-MM')] === undefined) await loadCalMonth(d)
      const set = tradingRef.current[d.format('YYYY-MM')]
      const hit = set ? set.has(d.format('YYYY-MM-DD')) : (d.day() !== 0 && d.day() !== 6)
      if (hit) { setEvalDate(d.format('YYYY-MM-DD')); return }
    }
    Toast.show({ content: '附近没找到可跳转的交易日' })
  }

  // 日历格子：收起 = 选中日所在的一周；展开 = 整月（前面补空位对齐星期日开头）
  // 所有真实日期都可点；颜色分三档：有评分记录（深+红点）/ 交易日没记录（淡玫瑰）/ 节假日周末（浅灰）
  const calCells = useMemo(() => {
    const mk = (d) => {
      const ds = d.format('YYYY-MM-DD')
      const set = tradingRef.current[ds.slice(0, 7)]
      const weekday = d.day()
      const trading = set ? set.has(ds) : (weekday !== 0 && weekday !== 6)
      const n = scoredDays[ds]
      return { ds, date: d.date(), hasData: n > 0, count: n || 0, isToday: ds === todayStr(), sel: ds === evalDate, trading }
    }
    const out = []
    if (calCollapsed) {
      const start = dayjs(evalDate).startOf('week')
      for (let i = 0; i < 7; i++) out.push(mk(start.add(i, 'day')))
      return out
    }
    const start = viewMonth.startOf('month')
    for (let i = 0; i < start.day(); i++) out.push({ ds: null })
    const days = viewMonth.endOf('month').date()
    for (let d = 1; d <= days; d++) out.push(mk(viewMonth.date(d)))
    return out
  }, [calCollapsed, evalDate, viewMonth, scoredDays, calVer])

  // 轮询扫描进度（粗筛→精选串在同一条 scanId 里，跑完才算 done）
  useEffect(() => {
    if (!scanId) return
    const tick = async () => {
      const res = await fortuneApi.getScanStatus(scanId)
      if (!res.ok) { setScanning(false); setScanId(null); Toast.show({ content: res.error || '打分任务丢失' }); return }
      const d = res.data
      setProgress(d.progress || 0); setStage(d.stage || '')
      setChipProg(d.chip_total ? `${d.chip_done || 0}/${d.chip_total}` : (d.chip_skipped || null))
      if (d.status === 'done') {
        setErrors(d.errors || [])
        setScanning(false); setScanId(null); setProgress(100)
        await loadBoard(evalDate)   // 完成后一律重读落库榜单（粗筛/精选两份口径都已是最新行）
        loadScoredDays()            // 新写入的评分日期要立刻在日历上亮起来
        const chipNote = d.chip_skipped ? `（筹码精选未跑：${d.chip_skipped}）` : ''
        Toast.show({ content: `打分完成：${(d.result || []).length} 只${chipNote}` })
      } else if (d.status === 'failed') {
        setScanning(false); setScanId(null)
        Toast.show({ content: d.error || '打分失败' })
      }
    }
    tick()
    pollRef.current = setInterval(tick, 1500)
    return () => clearInterval(pollRef.current)
  }, [scanId]) // eslint-disable-line

  // 「全部重打」范围 = 股票池 ∪ 当前榜单已有票，按代码去重：
  // 重打的语义是把榜单里所有票都按最新口径重算一遍，而不是只打池子里新增的（不在池但还在榜单上的旧票不能漏）
  const rescanList = useMemo(() => {
    const out = new Map()
    for (const s of stocks) out.set(String(s.symbol), { symbol: s.symbol, name: s.name || '', sector: s.sector || '' })
    for (const r of rows) if (!out.has(String(r.symbol))) out.set(String(r.symbol), { symbol: r.symbol, name: r.name || '', sector: r.sector || '' })
    return [...out.values()]
  }, [stocks, rows])

  const startScan = async (select) => {
    const list = rescanList
    if (!list.length) return Toast.show({ content: '先添加你今天选中的票（手动搜索或批量粘贴）' })
    setErrors([])
    const res = select
      ? await fortuneApi.startSelectScan(list, evalDate)
      : await fortuneApi.startScan(list, evalDate)
    if (!res.ok) return Toast.show({ content: res.error || '发起打分失败' })
    setScanning(true); setProgress(0); setStage(select ? '精选筹码准备' : '准备'); setChipProg(null); setScanId(res.data.scanId)
  }

  // 手动补筹码：取当前榜单排序靠前、且 B7 还没拿到真实筹码的 ≤select_max_chip 只，走精选轮
  const topupChip = () => {
    const max = Math.max(1, Number(doc?.chip?.select_max_chip) || 10)
    const list = [...rows]
      .sort((a, b) => ((b.SB ?? -1) - (a.SB ?? -1)) || (b.total - a.total))
      .filter(r => r.bEnabled && (!r.chip || r.chip.source !== 'real_api'))
      .slice(0, max)
      .map(r => ({ symbol: r.symbol, name: r.name, sector: r.sector || '' }))
    if (!list.length) return Toast.show({ content: '当前榜单已无待补筹码的标的（或反转打分模块未开启）' })
    Dialog.confirm({
      content: `对 ${list.length} 只标的串行请求真实筹码接口（补筹码分项），会覆盖今日评分记录并保留粗筛快照。`,
      onConfirm: async () => {
        const res = await fortuneApi.startSelectScan(list, evalDate)
        if (!res.ok) return Toast.show({ content: res.error || '发起精选筹码轮失败' })
        setScanning(true); setProgress(0); setStage('精选筹码准备'); setChipProg(`0/${list.length}`); setScanId(res.data.scanId)
      },
    })
  }

  // 把某只票的打分结果就地写回榜单（排序交给 sortedRows 派生）
  const upsertRow = useCallback((row) => {
    setRows(prev => [...prev.filter(r => r.symbol !== row.symbol), row])
  }, [])

  // 入队单票打分（去重）；若空闲会自动开始
  const enqueueScore = useCallback((code) => {
    const c = String(code || '').replace(/\D/g, '').slice(0, 6)
    if (!/^\d{6}$/.test(c)) return
    setScoreQ(q => (q.includes(c) ? q : [...q, c]))
  }, [])

  // 队列处理：一次只跑一只，避免并发把行情接口打爆
  useEffect(() => {
    if (scoringSym || !scoreQ.length || scanning) return
    const [next, ...rest] = scoreQ
    setScoringSym(next)
    fortuneApi.getStockScore(next, evalDate)
      .then(r => {
        if (r.ok) upsertRow(toRow(r.data, doc?.bands, doc?.criteria))
        else Toast.show({ content: `${next} 打分失败：${r.error || ''}` })
      })
      .catch(e => Toast.show({ content: `${next} 打分异常：${e.message}` }))
      .finally(() => { setScoreQ(rest); setScoringSym(null); if (!rest.length) loadScoredDays() })
  }, [scoreQ, scoringSym, scanning, evalDate, doc, upsertRow, loadScoredDays])

  // 股票池增删（沿用系统股票库搜索）
  const searchPool = async (v) => {
    setPoolKw(v)
    const q = (v || '').trim()
    if (q.length < 1) { setPoolHits([]); return }
    setSearching(true)
    try {
      const res = await stockApi.getList({ search: q, pageSize: 12 })
      setPoolHits((res.data || []).map(s => ({ symbol: s.code, name: s.name, market: s.market })))
    } catch { setPoolHits([]) } finally { setSearching(false) }
  }
  const addToPool = async (code, nm) => {
    const c = String(code || '').replace(/\D/g, '').slice(0, 6)
    if (!/^\d{6}$/.test(c)) return Toast.show({ content: '股票代码需 6 位数字' })
    const res = await fortuneApi.addStock({ symbol: c, name: nm || '' })
    if (!res.ok) return Toast.show({ content: res.error || '加入失败' })
    Toast.show({ content: res.notFound ? '已加入（股票库未匹配，可手填名称）' : `已加入：${res.data?.name || ''}` })
    setPoolKw(''); setPoolHits([])
    await loadStocks()
    enqueueScore(c) // 加入即开始给这只单独打分
  }
  const clearPool = () => {
    if (!stocks.length) return
    Dialog.confirm({
      content: `清空已选清单（共 ${stocks.length} 只）？已保存的打分/榜单不受影响，只是清单重开新的一天。`,
      onConfirm: async () => { await fortuneApi.clearStocks(); await loadStocks(); setRows([]); setErrors([]); Toast.show({ content: '清单已清空' }) },
    })
  }

  // 解析粘贴文本：每行 `代码 [名称] [板块]`，空格/逗号/制表分隔
  const parseBatch = (text, defaultSector) => {
    const lines = (text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean)
    const items = []
    for (const line of lines) {
      const tokens = line.split(/[\s,，|\t]+/).filter(Boolean)
      const code = (tokens[0] || '').replace(/\D/g, '').slice(0, 6)
      if (!/^\d{6}$/.test(code)) continue
      const name = tokens[1] || ''
      const sector = tokens[2] || defaultSector || ''
      items.push({ symbol: code, name, sector })
    }
    return items
  }

  const submitBatch = async () => {
    const items = parseBatch(batchText, batchSector)
    if (!items.length) return Toast.show({ content: '没有解析到有效股票（代码需 6 位数字）' })
    setBatchLoading(true)
    try {
      const res = await fortuneApi.addStocks(items)
      if (!res.ok) return Toast.show({ content: res.error || '批量加入失败' })
      const { added, updated, invalid, stocks } = res.data
      Toast.show({ content: `加入 ${added} 只，更新 ${updated} 只${invalid?.length ? `，无效 ${invalid.length}` : ''}` })
      await loadStocks()
      setBatchOpen(false); setBatchText('')
      // 批量加入后自动发起全部打分（粗筛 + 精选两轮）：范围同样取「新池 ∪ 榜单已有票」，与全部重打口径一致
      if (stocks?.length && !scanning) {
        const inPool = new Set(stocks.map(s => String(s.symbol)))
        const extra = rows.filter(r => !inPool.has(String(r.symbol))).map(r => ({ symbol: r.symbol, name: r.name || '', sector: r.sector || '' }))
        const scanRes = await fortuneApi.startScan([...stocks, ...extra], evalDate)
        if (scanRes.ok) { setScanning(true); setProgress(0); setStage('准备'); setChipProg(null); setScanId(scanRes.data.scanId) }
      }
    } catch (e) {
      Toast.show({ content: `批量加入异常：${e.message}` })
    } finally { setBatchLoading(false) }
  }

  const openDetail = (r) => navigate(`/fortune/stock/${r.symbol}?date=${evalDate}`, { state: { name: r.name } })

  const bandLegend = useMemo(() => doc?.bands || [], [doc])

  // 综合分参数（wA/wB）与筹码限流：真源在配置，页面只用来展示口径与判断能否走精选
  const ovCfg = doc?.openValue || {}
  const chipCfg = doc?.chip || {}
  const hasB = useMemo(() => rows.some(r => r.B != null), [rows])
  const hasW = useMemo(() => rows.some(r => r.exhTotal != null), [rows])
  const SORT_KEY = { S_A: r => r.SA, S_B: r => r.SB, A: r => r.total, B: r => r.B, W: r => r.exhTotal }

  // 选了用不了的排序口径（本批无 B 分 / 综合分已禁用）→ 退回买入分，不让人对着空列发懵
  const effSort = useMemo(() => {
    if ((sortMode === 'S_B' || sortMode === 'B') && !hasB) return sortMode === 'S_B' ? 'S_A' : 'A'
    if ((sortMode === 'S_A' || sortMode === 'S_B') && ovCfg.enabled === false) return 'A'
    return sortMode
  }, [sortMode, hasB, ovCfg.enabled])
  const sortHint = effSort !== sortMode
    ? (effSort === 'S_A' || effSort === 'A' ? '反转打分模块未开启或本批无反转分，已退回趋势口径' : '综合分未启用，已退回基础分排序')
    : ((sortMode === 'S_A' || sortMode === 'S_B') && !hasW ? '本批无衰竭分（未判定），综合分列会空着，重新打分后生成' : '')

  // 反转候选严格归类：流水线道氏判定的 B 类超跌反弹票（pool_type=B），或超跌整组前置成立且已拿到反转分（B>0）
  // 趋势池只留非反转票（不再揉杂）；反转池承接候选；混合观察仍全量两列对照
  const isReversal = (r) => r.pool_type === 'B' || (r.B != null && r.B > 0)
  const boardRows = useMemo(() => {
    const key = SORT_KEY[effSort] || SORT_KEY.A
    const base = pool === 'reversal' ? rows.filter(isReversal) : (pool === 'trend' ? rows.filter(r => !isReversal(r)) : rows)
    const dir = sortDir === 'desc' ? 1 : -1
    return [...base].sort((a, b) => (dir * ((key(b) ?? -1) - (key(a) ?? -1))) || (b.total - a.total))
  }, [rows, effSort, pool, sortDir])

  // 追资金流水线的道氏归类角标：对外只说业务名，不带 A/B 字母
  const poolTag = (r) => (r.pool_type === 'B' ? '超跌反弹票' : r.pool_type === 'A' ? '趋势票' : '')

  const switchPool = (p) => {
    if (p === 'reversal' && !hasB) return Toast.show({ content: '反转打分模块还没开启：去「权重配置 → 反转打分模块」打开后重新打分' })
    setPool(p)
    setSortMode(p === 'reversal' ? 'S_B' : 'S_A')
    setSortDir('desc')
  }

  // ===== 榜单删除：删当日评估记录 + 移出股票池后台清单（历史其它日期的存档不动） =====
  const applyDeleted = (syms) => {
    const s = new Set(syms.map(String))
    setRows(prev => prev.filter(r => !s.has(String(r.symbol))))
    setDelSel(prev => prev.filter(x => !s.has(String(x))))
    loadStocks()
    loadScoredDays() // 当天最后一只是被删掉时，日历红点同步消失
  }
  const toggleDelSel = (sym) => setDelSel(prev => (prev.includes(sym) ? prev.filter(x => x !== sym) : [...prev, sym]))
  const exitDelMode = () => { setDelMode(false); setDelSel([]) }

  // 单只直接删（行最右侧 🗑）
  const deleteOneRow = (r) => {
    Dialog.confirm({
      content: `删除 ${r.name || r.symbol}？移出股票池清单，并删除 ${evalDate} 的评分记录，不可恢复。`,
      confirmText: '删除',
      onConfirm: async () => {
        try {
          if (r.id != null) await fortuneApi.deleteEvaluation(r.id)
          await fortuneApi.removeStock(r.symbol)
          applyDeleted([r.symbol])
          Toast.show({ content: '已删除' })
        } catch (e) { Toast.show({ content: `删除失败：${e.message}` }) }
      },
    })
  }

  // 批量删除：勾选模式选中的一批 / 全部删除（当前榜单所有票）共用
  const batchDelete = (list, title) => {
    if (!list.length) return Toast.show({ content: '没有可删除的标的' })
    Dialog.confirm({
      content: `${title}：共 ${list.length} 只，将移出股票池清单并删除 ${evalDate} 的评分记录，不可恢复。`,
      confirmText: '删除',
      onConfirm: async () => {
        try {
          for (const r of list) {
            if (r.id != null) await fortuneApi.deleteEvaluation(r.id)
            await fortuneApi.removeStock(r.symbol)
          }
          applyDeleted(list.map(r => r.symbol))
          Toast.show({ content: `已删除 ${list.length} 只` })
        } catch (e) { Toast.show({ content: `删除失败：${e.message}` }) }
      },
    })
  }

  const sellBandLegend = doc?.sellBands || []
  const reversalBandLegend = doc?.reversalBands || []

  return (
    <div className="page-container" style={{ paddingBottom: 24 }}>
      {/* 标题 + 说明 + 配置 */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.primary, flex: 1 }}>🧧 招财进宝 · 今日选股打分</div>
          <Button size="small" fill="outline" style={{ '--border-color': C.accent, '--text-color': C.accent }} onClick={() => setShowConfig(true)}>权重配置</Button>
        </div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 6, lineHeight: 1.5 }}>
          清单是你主观选好的票；这里基于连续 120 根日线序列自动跑多个趋势指标模块（默认：道氏 30 + 葛兰碧 30 + 量价 12 + 均线 10，权重可配），
          买入分（趋势）= <b>Σ(模块分×权重) ÷ Σ(启用权重)</b>；「趋势票 / 超跌反弹票」归类标签只看走势形态，与下面的反转分不是一回事。
          <br />三个基础分：<b>买入分（趋势）</b>答「趋势好不好」、<b>反转分</b>答「超跌有没有底部反转结构」（权重配置页整组可开关，默认开启）、
          <b>衰竭分</b>答「兑现风险高不高」；两套综合分：<b>趋势综合分 = 买入分×{ovCfg.wA ?? 0.8} − 衰竭分×{ovCfg.wB ?? 0.2}</b>、<b>反转综合分 = 反转分×{ovCfg.wA ?? 0.8} − 衰竭分×{ovCfg.wB ?? 0.2}</b>，只用于候选排序。
          <br />打分分两轮：<b>粗筛</b>（不碰筹码接口，筹码分项记 0）→ <b>精选</b>（反转综合分靠前几只串行拉真实筹码补筹码分项，保留粗筛快照可对比）。
          <span style={{ color: '#c62828' }}>衰竭分是概率性风险提示，非强制卖出信号。</span>
        </div>
      </Card>

      {/* 时间点：迷你日历（参照首页模式，酒红色系、紧凑小字）+ 选股录入（股票池仅作后台清单，不再展示） */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ background: C.light, borderRadius: 10, padding: '5px 8px', marginBottom: 10 }}>
          {/* 顶行：左右切换 / 标题+回今日+展开收起 / 左右切换 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 20 }}>
            <span
              onClick={() => (calCollapsed ? stepDay(-1) : setViewMonth(viewMonth.subtract(1, 'month')))}
              style={{ fontSize: 10, color: C.primary, cursor: 'pointer', minWidth: 52, textAlign: 'center' }}>
              {calCollapsed ? '‹ 上一交易日' : '‹ 上月'}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>
                时间点 {calCollapsed ? `${evalDate} 周${WEEK[dayjs(evalDate).day()]}` : viewMonth.format('YYYY年M月')}
              </span>
              {evalDate !== todayStr() && (
                <span onClick={() => { setEvalDate(todayStr()); setViewMonth(dayjs()) }}
                  style={{ fontSize: 10, color: C.accent, cursor: 'pointer', whiteSpace: 'nowrap' }}>回今日</span>
              )}
              <span onClick={() => { setCalCollapsed(v => !v); if (calCollapsed) setViewMonth(dayjs(evalDate)) }}
                style={{ fontSize: 10, color: C.accent, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                {calCollapsed ? '展开 ▾' : '收起 ▴'}
              </span>
            </span>
            <span
              onClick={() => (calCollapsed ? stepDay(1) : setViewMonth(viewMonth.add(1, 'month')))}
              style={{ fontSize: 10, color: C.primary, cursor: 'pointer', minWidth: 52, textAlign: 'center' }}>
              {calCollapsed ? '下一交易日 ›' : '下月 ›'}
            </span>
          </div>
          {/* 星期头 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, margin: '2px 0 1px' }}>
            {WEEK.map(w => <div key={w} style={{ textAlign: 'center', fontSize: 9, color: '#b09a9d', padding: '1px 0' }}>{w}</div>)}
          </div>
          {/* 日历网格：收起显一周，展开显整月；所有日期都可点，颜色只区分有无评分记录 */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1 }}>
            {calCells.map((c, idx) => (
              <div key={idx}
                onClick={() => c.ds && setEvalDate(c.ds)}
                title={c.ds ? `${c.ds}${c.hasData ? ` · 有 ${c.count} 只评分记录` : c.trading ? ' · 交易日（无评分记录，点进去可直接打分补录）' : ' · 周末/节假日'}` : ''}
                style={{
                  textAlign: 'center', padding: '2px 0', borderRadius: 5, fontSize: 10, lineHeight: '13px',
                  cursor: c.ds ? 'pointer' : 'default',
                  background: c.sel ? C.primary : 'transparent',
                  color: c.sel ? '#fff' : c.hasData ? C.text : c.trading ? '#C08E93' : '#d8cccc',
                  fontWeight: c.sel || c.hasData ? 700 : 400,
                }}>
                {c.ds ? c.date : ''}
                {c.ds && c.hasData && !c.sel && <div style={{ width: 3, height: 3, borderRadius: '50%', background: C.accent, margin: '0 auto' }} />}
              </div>
            ))}
          </div>
          <div style={{ fontSize: 9, color: '#b09a9d', marginTop: 2 }}>• 红点 = 当日有评分记录（只数看悬停提示） · 淡玫瑰色 = 交易日未打分（也可点进去打分补录） · 浅灰 = 周末/节假日；删完当日记录，红点会同步消失</div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 12, color: '#666', flex: 1 }}>添加股票（已选 {stocks.length} 只）</span>
          <Button size="mini" fill="outline" style={{ '--border-color': C.tag, '--text-color': C.primary, marginRight: 6 }} onClick={() => setBatchOpen(v => !v)}>批量添加</Button>
          {stocks.length > 0 && (
            <Button size="mini" fill="outline" style={{ '--border-color': '#ddd', '--text-color': '#999' }} onClick={clearPool}>清空清单</Button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
          <Input placeholder="输入代码或名称搜索股票库…" value={poolKw} onChange={searchPool}
            onEnterPress={() => poolKw.trim() && addToPool(poolKw, '')}
            style={{ '--font-size': '13px', flex: 1, '--background-color': C.light }} />
          <Button size="small" color="primary" style={{ '--background-color': C.primary, '--border-color': C.primary }}
            onClick={() => addToPool(poolKw, '')}>加入</Button>
        </div>
        {(searching || poolHits.length > 0) && (
          <div style={{ marginTop: 8, border: `1px solid ${C.tag}`, borderRadius: 8, overflow: 'hidden' }}>
            {searching && <div style={{ padding: 8, fontSize: 12, color: '#999' }}>搜索中…</div>}
            {!searching && poolHits.length === 0 && <div style={{ padding: 8, fontSize: 12, color: '#bbb' }}>股票库无匹配（可点"加入"直接录代码）</div>}
            {!searching && poolHits.map(h => (
              <div key={h.symbol} onClick={() => addToPool(h.symbol, h.name)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderBottom: '1px solid #f4f4f4', cursor: 'pointer', fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: C.primary }}>{h.name}</span>
                <span style={{ color: '#999' }}>{h.symbol}</span>
                <span style={{ fontSize: 10, color: '#bbb', marginLeft: 2 }}>{{ SH: '上海', SZ: '深圳', BJ: '北京' }[h.market] || ''}</span>
                <div style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: C.accent }}>+ 加入</span>
              </div>
            ))}
          </div>
        )}
        
        {/* 批量添加面板 */}
        {batchOpen && (
          <div style={{ marginTop: 10, padding: 10, background: '#faf6f6', borderRadius: 8, border: `1px solid ${C.tag}` }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.primary, marginBottom: 6 }}>批量添加股票</div>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6, lineHeight: 1.6 }}>
              格式：每行一只，“代码 名称 板块”（空格、逗号或制表符分隔）。名称和板块可省略，留空自动从股票库补全名称。
              <br />例：<code style={{ background: '#f0e8e8', padding: '1px 4px', borderRadius: 3 }}>600519 贵州茅台 白酒</code>
            </div>
            <TextArea
              placeholder={'600519 贵州茅台 白酒\n000858 五粮液 白酒\n300750,宁德时代,电池'}
              value={batchText}
              onChange={setBatchText}
              rows={5}
              style={{ fontSize: 12, '--background-color': '#fff', borderRadius: 6, marginBottom: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Input placeholder="默认板块（行内未写板块时使用）" value={batchSector} onChange={setBatchSector}
                style={{ '--font-size': '12px', flex: 1, '--background-color': '#fff' }} />
              <Button size="small" color="primary" loading={batchLoading}
                style={{ '--background-color': C.primary, '--border-color': C.primary, whiteSpace: 'nowrap' }}
                onClick={submitBatch}>加入并打分</Button>
            </div>
          </div>
        )}

        <Button block color="primary" loading={scanning} style={{ '--background-color': C.primary, '--border-color': C.primary, marginTop: 10 }}
          onClick={() => startScan()}>{scanning ? '打分进行中…' : `全部重打（${rescanList.length} 只）`}</Button>
        {rescanList.length > stocks.length && (
          <div style={{ fontSize: 10, color: C.accent, marginTop: 4 }}>
            含榜单里不在股票池的 {rescanList.length - stocks.length} 只，一并按最新口径重算
          </div>
        )}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <Button size="mini" fill="outline" disabled={scanning} onClick={topupChip}
            style={{ '--border-color': C.tag, '--text-color': C.primary, whiteSpace: 'nowrap' }}>精选补筹码</Button>
          <span style={{ fontSize: 10, color: '#bbb', flex: 1, lineHeight: 1.4 }}>
            {chipCfg.enable_chip === false
              ? '配置已关闭筹码接口（enable_chip=false）：筹码分项一律记 0'
              : `粗筛 ≤${chipCfg.batch_max_pre_filter ?? 100} 只 · 精选 ≤${chipCfg.select_max_chip ?? 10} 只串行 · 间隔 ${chipCfg.chip_request_interval ?? 1000}ms`}
          </span>
        </div>
        {(scoringSym || scoreQ.length > 0) && (
          <div style={{ fontSize: 11, color: C.accent, marginTop: 6 }}>
            单票打分中：{scoringSym || '—'}{scoreQ.length > 0 ? `（排队 ${scoreQ.length} 只）` : ''}
          </div>
        )}
        {scanning && (
          <div style={{ marginTop: 8 }}>
            <ProgressBar percent={progress} style={{ '--fill-color': C.primary }} />
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>
              {stage || '准备中…'}
              {chipProg && chipProg.includes('/') ? `（筹码 ${chipProg}，串行逐只、不并发）` : ''}
            </div>
            {chipProg && !chipProg.includes('/') && (
              <div style={{ fontSize: 10, color: '#bbb', marginTop: 2 }}>本轮未跑精选筹码：{chipProg}</div>
            )}
          </div>
        )}
      </Card>

      {/* 打分榜单 */}
      <Card title={`打分榜单 · ${evalDate}`} style={{ marginBottom: 8 }}>
        {rows.length === 0 && !scanning && <Empty description="还没有评分，点上方「开始打分」" style={{ padding: '10px 0' }} />}
        {rows.length > 0 && (
          <>
            {/* 池子切换：全部（不分流总览）/ 趋势（剔除反转票）/ 反转（超跌反转候选）/ 混合观察（全量两列对照）；最右侧：批量删除（勾选模式）+ 全部删除 */}
            <div style={{ display: 'flex', gap: 6, margin: '2px 0 6px', alignItems: 'center', flexWrap: 'wrap' }}>
              {[['all', '🎯 全部'], ['trend', '📈 趋势池'], ['reversal', '🔄 反转池'], ['mixed', '🔀 混合观察']].map(([k, label]) => {
                const off = k === 'reversal' && !hasB
                return (
                  <span key={k} onClick={() => switchPool(k)}
                    title={off ? '反转打分模块未开启：去「权重配置 → 反转打分模块」打开后重新打分' : ''}
                    style={{
                      fontSize: 11, padding: '3px 10px', borderRadius: 12, cursor: 'pointer',
                      background: pool === k ? C.primary : C.light, color: pool === k ? '#fff' : C.primary,
                      border: `1px solid ${pool === k ? C.primary : C.tag}`, opacity: off ? 0.45 : 1,
                    }}>{label}</span>
                )
              })}
              <span onClick={() => (delMode ? exitDelMode() : setDelMode(true))}
                title={delMode ? '退出勾选删除模式' : '进入勾选模式，多选后统一删除'}
                style={{
                  marginLeft: 'auto', fontSize: 11, padding: '3px 10px', borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap',
                  background: delMode ? C.accent : '#fff', color: delMode ? '#fff' : C.accent,
                  border: `1px solid ${C.accent}`, fontWeight: delMode ? 700 : 400,
                }}>{delMode ? `✓ 退出勾选${delSel.length ? `（已选 ${delSel.length}）` : ''}` : '🗑 批量删除'}</span>
              {delMode && delSel.length > 0 && (
                <span onClick={() => batchDelete(rows.filter(r => delSel.includes(r.symbol)), `删除选中的 ${delSel.length} 只`)}
                  title="删除已勾选的标的（移出清单 + 删今日评分，二次确认）"
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, cursor: 'pointer', color: '#fff', background: '#b3261e', border: '1px solid #b3261e', whiteSpace: 'nowrap', fontWeight: 700 }}>🗑 删除选中 {delSel.length}</span>
              )}
              <span onClick={() => batchDelete(boardRows, '全部删除')} title="删除当前榜单所有票（移出清单 + 删今日评分）"
                style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, cursor: 'pointer', color: '#b3261e', background: '#fff', border: '1px solid #f0c4c2', whiteSpace: 'nowrap' }}>✕ 全部删除</span>
            </div>
            {/* 排序口径：两套综合分 + 三个基础分 */}
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', margin: '0 0 6px' }}>
              {[['S_A', '趋势综合'], ['S_B', '反转综合'], ['A', '买入分'], ['B', '反转分'], ['W', '衰竭分']].map(([k, label]) => {
                const off = (k === 'S_B' || k === 'B') && !hasB
                const active = effSort === k
                return (
                  <span key={k} onClick={() => {
                    if (active) setSortDir(d => (d === 'desc' ? 'asc' : 'desc'))
                    else { setSortMode(k); setSortDir('desc') }
                  }}
                    title={off ? '反转打分模块未开启或本批无反转分' : active ? `已按${label} ${sortDir === 'desc' ? '降序（大→小）' : '升序（小→大）'}，再点一次切换方向` : `点击按${label}降序排列`}
                    style={{
                      fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                      background: effSort === k ? C.accent : '#fff', color: effSort === k ? '#fff' : C.accent,
                      border: `1px solid ${effSort === k ? C.accent : C.tag}`, opacity: off ? 0.45 : 1,
                    }}>{label}{active ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}</span>
                )
              })}
            </div>
            {sortHint && <div style={{ fontSize: 10, color: C.accent, marginBottom: 4 }}>ℹ️ {sortHint}</div>}
            {rows.length > 0 && boardRows.length === 0 && (
              <div style={{ fontSize: 11, color: '#bbb', padding: '6px 4px' }}>
                {pool === 'reversal'
                  ? '本批没有已拿到反转分的超跌票（都走趋势赛道，或反转分未产出——重新打分后生效）'
                  : '本批票全部归入反转池，趋势池暂无标的（可切到反转池 / 混合观察查看）'}
              </div>
            )}
            <div style={{ display: 'flex', fontSize: 11, color: '#999', padding: '0 4px 6px', borderBottom: `1px solid ${C.tag}` }}>
              <span style={{ width: 26 }}>#</span>
              <span style={{ flex: 1 }}>名称 / 代码 / 分数徽标</span>
              {pool === 'trend' && <span style={{ width: 78, textAlign: 'right' }}>模块分</span>}
              {pool !== 'reversal' && <span style={{ width: 42, textAlign: 'right', fontSize: 10 }} title={`趋势综合分 = 买入分（趋势）×${ovCfg.wA ?? 0.8} − 衰竭分×${ovCfg.wB ?? 0.2}（钳位后平移为 0～100）`}>趋势综合</span>}
              {pool !== 'trend' && <span style={{ width: 42, textAlign: 'right', fontSize: 10 }} title={`反转综合分 = 反转分×${ovCfg.wA ?? 0.8} − 衰竭分×${ovCfg.wB ?? 0.2}`}>反转综合</span>}
              <span style={{ width: 52, textAlign: 'right' }}>分档</span>
              <span style={{ width: 30, textAlign: 'center' }}>{delMode ? '选中' : '打分'}</span>
            </div>
            {boardRows.map((r, i) => {
              const cb = r.chip ? (CHIP_BADGE[r.chip.source] || CHIP_BADGE.none) : null
              const big = (pool === 'mixed' || pool === 'all') ? 13 : 16
              return (
              <div key={r.symbol} onClick={() => { if (delMode) toggleDelSel(r.symbol); else openDetail(r) }}
                style={{ display: 'flex', alignItems: 'center', padding: '9px 4px', borderBottom: '1px solid #f4f4f4', cursor: 'pointer', background: delMode && delSel.includes(r.symbol) ? C.light : 'transparent' }}>
                <span style={{ width: 26, fontSize: 12, color: i < 3 && !delMode ? C.primary : '#bbb', fontWeight: i < 3 ? 800 : 400 }}>{delMode ? (delSel.includes(r.symbol) ? '☑' : '☐') : i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.name || r.symbol}
                    {r.sector && <span style={{ fontSize: 10, fontWeight: 600, color: C.accent, border: `1px solid ${C.tag}`, borderRadius: 8, padding: '1px 6px', marginLeft: 4 }}>{r.sector}</span>}
                    {r.run_stage && <span style={{ fontSize: 9, fontWeight: 600, color: C.primary, background: C.tag, borderRadius: 8, padding: '1px 5px', marginLeft: 4 }} title="本轮打分口径">{STAGE_LABEL[r.run_stage] || r.run_stage}</span>}
                    {cb && <span style={{ fontSize: 9, fontWeight: 600, color: cb.color, border: `1px solid ${C.tag}`, borderRadius: 8, padding: '1px 5px', marginLeft: 4 }} title={r.chip.detail}>{cb.text}</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.symbol}
                    {(r.trend_label || r.pool_type) && (
                      <span style={{ marginLeft: 4, color: r.pool_type === 'B' ? C.accent : C.primary }}>{poolTag(r) || r.trend_label}</span>
                    )}
                    {r.ma_state_label && <span style={{ marginLeft: 4 }}>{r.ma_state_label}</span>}
                    {r.drawdown_pct != null && <span style={{ marginLeft: 4 }} title="现价距 60 日高的回撤（反转打分整组前置）">回撤 {fmt(r.drawdown_pct, 1)}%</span>}
                    {r.data_as_of ? ` · 数据到 ${r.data_as_of}` : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 3 }}>
                    <ScoreChip label="买入分" value={r.total} color={scoreColor(r.total)} title="买入分（趋势）：趋势指标模块加权" />
                    <ScoreChip label="反转分" value={r.B} color={r.bBand?.color || '#ccc'} title={`反转分${r.bBand ? '：' + (r.bBand.icon || '') + r.bBand.label : ''}${r.bEnabled ? '' : '（反转打分模块未开启/未判定）'}${r.B === 0 && r.oversold === false ? `：未达超跌前置（60 日回撤 ${r.drawdown_pct == null ? '—' : r.drawdown_pct.toFixed(1)}%），各反转子项全不计分` : ''}`} />
                    <ScoreChip label="衰竭分" value={r.exhTotal} color={r.exhBand?.color || '#ccc'} title={`衰竭分${r.exhBand ? '：' + (r.exhBand.icon || '') + r.exhBand.label : ''}：越高兑现风险越大`} />
                    <ScoreChip label="趋势综合" value={r.SA} color={scoreColor(r.SA)} title={`趋势综合分 = 买入分（趋势）×${r.wA} − 衰竭分×${r.wB}`} />
                    <ScoreChip label="反转综合" value={r.SB} color={scoreColor(r.SB)} title={`反转综合分 = 反转分×${r.wA} − 衰竭分×${r.wB}`} />
                  </div>
                </span>
                {pool === 'trend' && (
                  <span style={{ width: 78, display: 'flex', justifyContent: 'flex-end', gap: 3, flexWrap: 'wrap' }}>
                    {r.modules.map(m => (
                      <span key={m.code} title={`${m.name} ${Math.round(m.score)}`} style={{ fontSize: 9, lineHeight: '14px', padding: '0 4px', borderRadius: 7, background: C.light, color: scoreColor(m.score), whiteSpace: 'nowrap' }}>
                        {m.name} {Math.round(m.score)}
                      </span>
                    ))}
                    {r.moduleCount > r.modules.length && <span style={{ fontSize: 9, color: '#bbb', lineHeight: '14px' }}>+{r.moduleCount - r.modules.length}</span>}
                    {!r.modules.length && <span style={{ fontSize: 12, color: '#ccc' }}>—</span>}
                  </span>
                )}
                {pool !== 'reversal' && (
                  <span style={{ width: 42, textAlign: 'right', fontSize: big, fontWeight: 900, color: scoreColor(r.SA) }} title="趋势综合分">{fmt(r.SA, 1)}</span>
                )}
                {pool !== 'trend' && (
                  <span style={{ width: 42, textAlign: 'right', fontSize: big, fontWeight: 900, color: r.SB == null ? '#ccc' : (r.bBand?.color || C.primary) }} title="反转综合分">{fmt(r.SB, 1)}</span>
                )}
                <span style={{ width: 52, textAlign: 'right' }}>
                  <span style={{ fontSize: 10, color: '#fff', background: r.band.color || '#999', borderRadius: 10, padding: '2px 6px' }}>{r.band.label || '—'}</span>
                </span>
                {delMode ? (
                  <span onClick={(e) => { e.stopPropagation(); deleteOneRow(r) }}
                    style={{ width: 30, textAlign: 'center', fontSize: 14, cursor: 'pointer', color: '#c62828' }}
                    title="直接删除这只（二次确认）">
                    🗑
                  </span>
                ) : (
                  <span
                    onClick={(e) => { e.stopPropagation(); enqueueScore(r.symbol) }}
                    style={{ width: 30, textAlign: 'center', fontSize: 14, cursor: 'pointer', color: (scoringSym === r.symbol || scoreQ.includes(r.symbol)) ? C.accent : '#bbb' }}
                    title="只给这只打分（不请求筹码）">
                    {scoringSym === r.symbol ? '◌' : scoreQ.includes(r.symbol) ? '⏳' : '⚡'}
                  </span>
                )}
              </div>
              )
            })}
          </>
        )}
        {errors.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.accent }}>
            <div style={{ marginBottom: 2 }}>未取到 / 跳过（{errors.length}）：</div>
            {errors.map((er, i) => <div key={i} style={{ color: '#999' }}>· {er.symbol} — {er.error}</div>)}
          </div>
        )}
      </Card>

      {/* 分档图例 */}
      {bandLegend.length > 0 && (
        <Card title="分档标准">
          <div style={{ fontSize: 11, color: '#666', margin: '0 0 4px' }}>买入分（趋势）分档</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {bandLegend.map(b => (
              <span key={b.code} style={{ fontSize: 11, color: b.color, border: `1px solid ${b.color}`, borderRadius: 12, padding: '2px 10px' }}>
                {b.label} {fmt(b.min, 0)}–{b.max > 100 ? '100' : fmt(b.max, 0)}
              </span>
            ))}
          </div>
          {sellBandLegend.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#666', margin: '10px 0 4px' }}>衰竭分 · 分数越高兑现风险越大</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {sellBandLegend.map(b => (
                  <span key={b.code} style={{ fontSize: 11, color: '#fff', background: b.color, borderRadius: 12, padding: '2px 10px' }} title={b.advice || ''}>
                    {b.icon || ''} {b.label} {fmt(b.min, 0)}–{b.max > 100 ? '100' : fmt(b.max, 0)}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#b3261e', marginTop: 6 }}>衰竭分是概率性风险提示，非强制卖出信号；高位≠马上跌，趋势票可边持边警戒。</div>
            </>
          )}
          {reversalBandLegend.length > 0 && (
            <>
              <div style={{ fontSize: 11, color: '#666', margin: '10px 0 4px' }}>反转分 · 越高越接近可介入的底部反转</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {reversalBandLegend.map(b => (
                  <span key={b.code} style={{ fontSize: 11, color: '#fff', background: b.color, borderRadius: 12, padding: '2px 10px' }} title={b.advice || ''}>
                    {b.icon || ''} {b.label} {fmt(b.min, 0)}–{b.max > 100 ? '100' : fmt(b.max, 0)}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 6 }}>
                反转打分模块可在「权重配置」整组开关；筹码分项只认筹码接口真实数据，粗筛轮一律记 0。
              </div>
            </>
          )}
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 8 }}>{doc?.formula || ''}</div>
        </Card>
      )}

      <CriteriaConfig visible={showConfig} onClose={() => setShowConfig(false)} doc={doc} onSaved={(d) => { setDoc(d); setShowConfig(false) }} />
    </div>
  )
}
