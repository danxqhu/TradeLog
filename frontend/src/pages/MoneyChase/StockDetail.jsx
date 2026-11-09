/**
 * 每日追资金 —— 单只票具体分析页（点股票名进入）
 *
 * 页面分两块，它们是两件事，不能只用一套逻辑：
 *   📌 快照评估（定格）= 按选定时间点（盘中时刻或当日收盘）截取历史 K 线跑一遍判定后存档，
 *      之后新增 K 线不会重算、不会推翻当初结论，用来回答「我当时为什么看上它」；
 *   🔄 当前最新评估（动态）= 每次进来用最新 K 线重跑，用来回答「它现在变成什么样」（跟踪离场/调仓）。
 *
 * 与「批次打分」用的是同一条 Python 流水线（脚本 --action analyze / --action snapshot），判定口径完全一致；
 * 数据源默认新浪：日线 1 次 + 实时快照 1 次 + 分时 1 次，每次都只请求 1 遍、不重试，
 * 后端再按盘中 60 秒 / 收盘后 10 分钟缓存，所以反复点进来也不会打爆接口。
 * 生成定格快照才额外请求（收盘口径 1 次日线；盘中口径日线 1 + 分时 1~2）；查看/切换/删除快照只查库，0 外部请求。
 *
 * 不依赖批次：人工加入的股票点进来就会自动打分，并把结果落成这票自己的打分记录（当日单票分析批次），
 * 所以人工复核勾选 / 备注 / 选中 / 淘汰当场就能保存，不用回到首页再跑一次「开始筛选打分」。
 * 录入那次打分结果会被顺带固化成基准快照（0 额外请求），页面上的勾选改动不会回头改快照。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, Dialog, Input, NavBar, Toast } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'
import { moneyChaseApi } from '../../services/api'
import KlineChart from './KlineChart'
import MinuteChart from './MinuteChart'

const C = {
  primary: '#8B3A42', accent: '#C4737A', tag: '#F5E6E8', light: '#FAF0F1',
  up: '#e74c3c', down: '#27ae60', text: '#666',
}

const fmt = (v, n = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(n))
const pctCls = v => (v == null ? '#999' : v > 0 ? C.up : v < 0 ? C.down : '#999')
const DOW_TEXT = { UP: '上升', DOWN: '下降', SHAKE: '震荡' }

function Section({ title, right, children, tip }) {
  return (
    <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: tip ? 2 : 6 }}>
        <span style={{ fontSize: 13, fontWeight: 700, flex: 1 }}>{title}</span>
        {right}
      </div>
      {tip && <div style={{ fontSize: 10, color: '#999', lineHeight: 1.5, marginBottom: 6 }}>{tip}</div>}
      {children}
    </div>
  )}

/** 快照标题文案：收盘口径没有时刻，要写清「收盘定型」 */
const snapTitle = s => `${s.snapshot_date}${s.snapshot_time ? ` ${s.snapshot_time}（盘中）` : '（当日收盘定型）'}`

/** 只读逐项打分（快照区用：当时打了几分、哪几项没满足，都是定格数据） */
function FlatScoreList({ items, empty }) {
  if (!items || items.length === 0) return <div style={{ fontSize: 11, color: '#999' }}>{empty}</div>
  return (
    <>
      {items.map(s => (
        <div key={s.code || s.label} style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.6, padding: '3px 0', borderBottom: '1px dashed #f0f0f0' }}>
          <span style={{ width: 16, flexShrink: 0, fontWeight: 700, color: s.met ? C.primary : '#bbb' }}>{s.met ? '✓' : '✗'}</span>
          <div style={{ flex: 1 }}>
            <span style={{ color: s.met ? '#333' : '#999' }}>
              <span style={{ color: C.accent, marginRight: 4 }}>{s.code}</span>{s.label}
            </span>
            <div style={{ color: s.met ? C.text : '#b0a3a5' }}>{s.detail}</div>
          </div>
        </div>
      ))}
    </>
  )
}

export default function StockDetail() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const sector = useMemo(() => new URLSearchParams(location.search).get('sector') || '人工自选', [location.search])

  const [data, setData] = useState(null)
  const [highlight, setHighlight] = useState({})
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)

  // 人工复核 / 备注 / 淘汰 / 选中：落在本票自己的打分记录上（分析完自动写好的那一行，candidate.id）
  const [checks, setChecks] = useState([])
  const [remark, setRemark] = useState({ resist: '', stop_profit: '', buy_plan: '', note: '' })
  const [pick, setPick] = useState(false)
  const [elim, setElim] = useState({ eliminated: false, source: null })
  const [manualScore, setManualScore] = useState(0)

  // ===== 定格快照（只查库，不请求数据源；只有「按时间点生成」才会请求） =====
  const [snapList, setSnapList] = useState([])
  const [snapId, setSnapId] = useState(null)          // 当前展开看的那份快照（默认基准）
  const [snapFull, setSnapFull] = useState(null)      // 快照全文（含当时口径的 K 线/分时），点「看当时的图」才取
  const [showSnapChart, setShowSnapChart] = useState(false)
  const [snapForm, setSnapForm] = useState({ date: '', time: '' })
  const [snapBusy, setSnapBusy] = useState(false)
  const [snapErr, setSnapErr] = useState('')

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setErr(null)
    try {
      const res = await moneyChaseApi.getStockAnalysis(symbol, sector, force)
      if (!res.ok) {
        setErr({ error: res.error || '单票分析失败', detail: res.errorDetail || '' })
        setData(null)
        return
      }
      const d = res.data || {}
      setData(d)
      setHighlight(res.highlight || {})
      const cand = d.candidate
      setChecks(cand?.manual_checks || d.manual_checks || [])
      setRemark({ resist: '', stop_profit: '', buy_plan: '', note: '', ...(cand?.remark || {}) })
      setPick(!!cand?.picked)
      setElim({ eliminated: !!cand?.eliminated, source: cand?.elim_source || null })
      setManualScore(cand?.manual_score || 0)
    } catch {
      setErr({ error: '后端请求失败（可能超时）。脚本每次只请求 1 遍数据源、不会自动重试，你可以过一会儿点「重新分析」。' })
    } finally {
      setLoading(false)
    }
  }, [symbol, sector])

  useEffect(() => { load(false) }, [load])

  // 快照列表只查本地表（money_chase_snapshots），不请求任何数据源
  const loadSnaps = useCallback(async () => {
    try {
      const res = await moneyChaseApi.listSnapshots(symbol)
      if (res.ok && Array.isArray(res.data)) {
        setSnapList(res.data)
        setSnapId(prev => {
          if (prev && res.data.some(x => x.id === prev)) return prev
          const b = res.data.find(x => x.is_baseline) || res.data[0]
          return b ? b.id : null
        })
        setShowSnapChart(false)
      } else {
        setSnapList([])
      }
    } catch {
      // 列表接口挂了也不白屏：还有分析结果里自带的基准快照可用
      setSnapList([])
    }
  }, [symbol])

  useEffect(() => { loadSnaps() }, [loadSnaps])

  const stock = data?.stock || null
  const meta = data?.meta || {}
  const ind = stock?.indicators || {}
  const cand = data?.candidate || null
  const pool = stock?.pool_type || cand?.pool_type || 'A'
  const threshold = highlight[pool] ?? 99
  const redLines = stock?.red_lines || []
  const rowWarnings = stock?.warnings || ind.warnings || []
  const metaWarnings = data?.warnings || []
  const scoreParts = stock?.score_detail || []
  const autoScore = stock?.auto_score ?? cand?.auto_score
  const maxScore = stock?.max_auto_score ?? cand?.max_auto_score
  const totalScore = cand ? (cand.total_score ?? ((autoScore || 0) + manualScore)) : autoScore

  const persist = async (patch, tip) => {
    if (!cand) {
      Toast.show({ content: '这条分析结果还没在本地落库（多半是数据库写入失败），点「重新分析」重试一次', icon: 'fail' })
      return
    }
    setSaving(true)
    try {
      const res = await moneyChaseApi.updateCandidate(cand.id, patch)
      if (res.ok) {
        setChecks(res.data.manual_checks || [])
        setRemark({ resist: '', stop_profit: '', buy_plan: '', note: '', ...(res.data.remark || {}) })
        setManualScore(res.data.manual_score || 0)
        setPick(!!res.data.picked)
        setElim({ eliminated: !!res.data.eliminated, source: res.data.elim_source || null })
        if (tip) Toast.show({ content: tip })
        return
      }
      Toast.show({ content: res.error || '保存失败', icon: 'fail' })
    } catch {
      Toast.show({ content: '保存请求失败', icon: 'fail' })
    } finally {
      setSaving(false)
    }
  }

  const toggleCheck = (code) => {
    const next = checks.map(x => (x.code === code ? { ...x, checked: !x.checked } : x))
    setChecks(next)
    persist({ manual_checks: next })
  }

  const rejectThis = () => {
    Dialog.confirm({
      content: `把 ${stock?.name || symbol} 从人工候选清单剔除？剔除后批次打分与定时运行都不会再带上它（可随时在②清单点「恢复」）。`,
      onConfirm: async () => {
        const res = await moneyChaseApi.adjustManualStocks({ remove: [{ symbol, name: stock?.name || '', sector: stock?.sector || sector }] })
        if (res.ok) { Toast.show({ content: '已剔除该股票', icon: 'success' }); navigate(-1) }
        else Toast.show({ content: res.error || '剔除失败', icon: 'fail' })
      },
    })
  }

  const ds = data?.data_source || {}

  // ===== 快照派生数据 =====
  const snaps = snapList.length ? snapList : (data?.baseline_snapshot ? [data.baseline_snapshot] : [])
  const activeSnap = snaps.find(x => x.id === snapId) || snaps.find(x => x.is_baseline) || snaps[0] || null
  const snapDateDefault = meta.trade_date || stock?.data_as_of || ''
  const snapInd = activeSnap?.indicators || {}
  // 快照表没单独存昨收，用当时的现价与涨幅反推，够画分时基准线
  const snapPrevClose = snapInd.price != null && activeSnap?.today_pct != null
    ? Number(snapInd.price) / (1 + Number(activeSnap.today_pct) / 100) : null

  const genSnapshot = async (overwrite = false) => {
    const date = String(snapForm.date || snapDateDefault || '').trim()
    const time = String(snapForm.time || '').trim()
    if (!date) {
      Toast.show({ content: '先选快照日期（默认今天）', icon: 'fail' })
      return
    }
    setSnapBusy(true)
    setSnapErr('')
    try {
      const res = await moneyChaseApi.createSnapshot({
        symbol, as_of_date: date, as_of_time: time,
        sector: stock?.sector || sector, name: stock?.name || '', overwrite,
      })
      if (res.conflict) {
        // 同一时间点已有旧存档：后端先查库拦住了，连接口都没请求；要不要覆盖由人工定
        setSnapBusy(false)
        const goOver = await Dialog.confirm({
          title: '这个时间点已有快照',
          content: res.error || '',
          confirmText: '覆盖重生成',
          cancelText: '保留原样',
        })
        if (goOver) return genSnapshot(true)
        return
      }
      if (res.ok && res.data) {
        Toast.show({
          content: res.is_baseline
            ? `已${res.replaced ? '覆盖重生成' : '新增'} ${snapTitle(res.data)}，它当前就是基准`
            : `已${res.replaced ? '覆盖重生成' : '新增'} ${snapTitle(res.data)}，基准仍是原先那份（可点「设为基准」切换）`,
          icon: 'success',
          duration: 2600,
        })
        setSnapId(res.data.id)
        setShowSnapChart(false)
        await loadSnaps()
        setSnapId(res.data.id)
        return
      }
      // 失败只弹窗提示人工重试，脚本不会自动重试（避免被数据源限流）
      const msg = res.error || '生成快照失败'
      setSnapErr(msg)
      Dialog.alert({ title: '生成快照失败', content: msg, confirmText: '我知道了' })
    } catch {
      const msg = '生成快照请求失败（后端可能超时）。脚本只请求 1 遍、不会自动重试，你可以稍后再点一次。'
      setSnapErr(msg)
      Dialog.alert({ title: '生成快照失败', content: msg, confirmText: '我知道了' })
    } finally {
      setSnapBusy(false)
    }
  }

  // 图按需取：快照的 K 线 / 分时存在这一行里，点开才查库，不进页面就不多拉一大块 JSON
  const toggleSnapChart = async () => {
    if (showSnapChart) { setShowSnapChart(false); return }
    if (!activeSnap) return
    if (snapFull && snapFull.id === activeSnap.id) { setShowSnapChart(true); return }
    setSnapBusy(true)
    try {
      const res = await moneyChaseApi.getSnapshot(activeSnap.id)
      if (res.ok) {
        setSnapFull(res.data)
        setShowSnapChart(true)
      } else {
        Toast.show({ content: res.error || '读取快照详情失败', icon: 'fail' })
      }
    } catch {
      Toast.show({ content: '读取快照详情失败（可能已被删除），试试刷新列表', icon: 'fail' })
    } finally {
      setSnapBusy(false)
    }
  }

  const markBaseline = async (s) => {
    try {
      const res = await moneyChaseApi.setSnapshotBaseline(s.id)
      if (res.ok) {
        Toast.show({ content: `已把 ${snapTitle(s)} 设为基准`, icon: 'success' })
        await loadSnaps()
      } else Toast.show({ content: res.error || '设置基准失败', icon: 'fail' })
    } catch { Toast.show({ content: '设置基准请求失败', icon: 'fail' }) }
  }

  const dropSnap = (s) => {
    Dialog.confirm({
      content: `删掉 ${snapTitle(s)} 这份快照？删完就找不回来了（当初的选股依据会丢）。删的是基准时，会自动把剩下最新一份顶上。`,
      onConfirm: async () => {
        try {
          const res = await moneyChaseApi.deleteSnapshot(s.id)
          if (res.ok) {
            Toast.show({ content: '已删除该快照' })
            setSnapFull(null)
            setShowSnapChart(false)
            setSnapId(null)
            await loadSnaps()
          } else Toast.show({ content: res.error || '删除失败', icon: 'fail' })
        } catch { Toast.show({ content: '删除请求失败', icon: 'fail' }) }
      },
    })
  }

  return (
    <div className="page-container" style={{ '--adm-color-primary': C.primary }}>
      <NavBar onBack={() => navigate(-1)} style={{ background: '#fff', fontWeight: 700, color: C.primary }}>
        具体分析 · {stock?.name || symbol}
      </NavBar>

      {/* ===== 概要 ===== */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 18, fontWeight: 700 }}>{stock?.name || (loading ? '加载中…' : '未取到名称')}</span>
          <span style={{ fontSize: 12, color: '#999' }}>{symbol}</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: pctCls(stock?.today_pct) }}>
            {stock?.today_pct == null ? '—' : `${stock.today_pct > 0 ? '+' : ''}${fmt(stock.today_pct)}%`}
          </span>
          <span style={{ fontSize: 13, color: pctCls(stock?.today_pct) }}>¥{fmt(ind.price ?? stock?.price)}</span>
          <span style={{ fontSize: 11, background: C.tag, color: C.primary, padding: '1px 8px', borderRadius: 8 }}>{pool} 池</span>
          <span style={{ fontSize: 11, color: '#999' }}>{stock?.sector || sector}</span>
          <span style={{ marginLeft: 'auto', fontSize: 17, fontWeight: 700, color: C.primary }}>
            {totalScore ?? '—'}
            <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}> / {threshold} 达标</span>
          </span>
        </div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 4, lineHeight: 1.6 }}>
          自动 {autoScore ?? '—'}/{maxScore ?? '—'}　人工 {manualScore}
          {cand
            ? (cand.is_single
              ? `　·　本票的自动打分记录（${cand.data_as_of || '—'}，没跑批次也有，重跑批次不影响这一行）`
              : `　·　来自批次 #${cand.run_id}（${cand.data_as_of || '—'}）`)
            : '　·　打分结果还没落库，点「重新分析」重试'}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button block size="small" fill="outline" loading={loading} onClick={() => load(true)}>重新分析（不走缓存）</Button>
          <Button block size="small" fill="outline" color="danger" onClick={rejectThis}>剔除这只股票</Button>
        </div>

        {/* 数据源与时效：把「这次打了几个接口、用的是新浪还是东财、结果还新不新」写清楚 */}
        <div style={{ marginTop: 8, background: C.light, borderRadius: 8, padding: 8, fontSize: 10, color: C.text, lineHeight: 1.6 }}>
          <div>
            数据源：日线 {ds.daily === 'sina' ? '新浪（不占东财配额）' : ds.daily || '—'}　实时价 {ds.spot === 'sina' ? '新浪快照（批量 1 次）' : ds.spot || '—'}
            　分时 {stock?.minutes?.length ? `新浪 ${stock.minutes_period_min || 1} 分钟 × ${stock.minutes.length} 点` : '未取到'}
          </div>
          <div>
            分析时间 {data?.analyzed_at || '—'}
            {data?.cached ? `　·　命中缓存 ${data.age_sec ?? 0} 秒前（有效期 ${data.cache_sec} 秒，不重复请求接口）` : '　·　本次实打实请求了数据源'}
            {meta.intraday ? `　·　盘中已交易 ${meta.elapsed_trading_min ?? '—'} 分钟，量能折算 ×${fmt(meta.vol_scale)}` : '　·　非盘中，按完整日 bar 计算'}
          </div>
          {(meta.spot_missing || []).length > 0 && (
            <div style={{ color: '#b7791f' }}>新浪快照没返回这些代码：{(meta.spot_missing || []).join('、')}（已回落东财或按数据缺失计）</div>
          )}
        </div>

        {/* 基准快照一句话预告：当初的结论与现在不同时要能看出来，点文字滚到定格快照区 */}
        {activeSnap && (
          <div style={{ marginTop: 6, fontSize: 11, color: C.primary, lineHeight: 1.6 }}>
            📌 基准快照 {snapTitle(activeSnap)}：当时 {activeSnap.pool_type || '—'} 池 自动 {activeSnap.auto_score ?? '—'}/{activeSnap.max_auto_score ?? '—'}{activeSnap.eliminated ? ' 已淘汰' : ''}
            　·　共 {snaps.length} 份
            <span
              style={{ color: '#999', fontSize: 10 }}
              onClick={() => document.getElementById('mc-snap')?.scrollIntoView({ behavior: 'smooth' })}
            >　看当初的判定 →</span>
          </div>
        )}
      </Card>

      {err && (
        <Card>
          <div style={{ fontSize: 12, color: C.up, lineHeight: 1.6 }}>❌ {err.error}</div>
          {err.detail && (
            <div style={{ fontSize: 10, color: '#999', marginTop: 6, wordBreak: 'break-all' }}>技术细节：{String(err.detail).slice(0, 600)}</div>
          )}
          <div style={{ fontSize: 10, color: '#999', marginTop: 6 }}>
            脚本不会自动重试（避免被数据源限流）。可以过几分钟点上面的「重新分析」，或到首页改数据源参数（规则与参数 → 接口与健壮性 → 日线与实时价数据源）。
          </div>
        </Card>
      )}

      {!loading && !err && stock && (
        <>
          {/* ==================== 区块一：📌 快照评估（定格、只读） ==================== */}
          <div id="mc-snap" />
          <Section
            title={`📌 快照评估${activeSnap ? `（选定时间点：${snapTitle(activeSnap)}）` : ''}`}
            right={<span style={{ fontSize: 10, color: '#999' }}>共 {snaps.length} 份</span>}
            tip="按选定时间点截取历史 K 线，跑同一套指标 / A·B 归类 / 红线后存档；之后新增 K 线不会重算、不会推翻当初结论 —— 回答「我当时为什么看上它」"
          >
            {/* 时间点输入：日期默认今天，时刻留空 = 当日收盘定型口径 */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
              <Input
                value={snapForm.date}
                onChange={v => setSnapForm(p => ({ ...p, date: v }))}
                placeholder={snapDateDefault || 'YYYY-MM-DD'}
                style={{ '--font-size': '12px', width: 110 }}
              />
              <Input
                value={snapForm.time}
                onChange={v => setSnapForm(p => ({ ...p, time: v }))}
                placeholder="HH:MM（留空=收盘）"
                style={{ '--font-size': '12px', flex: 1, minWidth: 120 }}
              />
              <Button size="mini" color="primary" loading={snapBusy} onClick={() => genSnapshot()}>按这个时间点生成快照</Button>
            </div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              {[
                ['今天收盘定型', ''],
                ['今天 10:00', '10:00'],
                ['今天 14:30', '14:30'],
              ].map(([label, t]) => (
                <span
                  key={label}
                  onClick={() => setSnapForm(p => ({ ...p, time: t }))}
                  style={{ fontSize: 11, padding: '2px 8px', borderRadius: 8, background: '#fff', border: '1px solid #eee', color: C.text }}
                >{label}</span>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#999', lineHeight: 1.6, marginBottom: 6 }}>
              盘中口径要用新浪分时还原当日临时 K，分时只覆盖最近约 7 个交易日；超出范围脚本会直接告诉你这天只能取收盘快照（不静默降级）。想留稳定可复盘的存档，建议不填时刻取当日收盘。
              　盘中 / 收盘 / 后续手动生成的快照全部并存保留，同一时间点重生会先问你确不确认覆盖，不会静默改掉旧存档。
            </div>
            {snapErr && (
              <div style={{ fontSize: 11, color: C.up, background: '#FDECEC', borderRadius: 8, padding: 8, lineHeight: 1.6, marginBottom: 6 }}>❌ {snapErr}</div>
            )}

            {/* 多份快照并存，点一份看当时的定格结论；★ 是基准（录入页默认展示那份） */}
            {snaps.length > 0 && (
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                {snaps.map(s => (
                  <span
                    key={s.id}
                    onClick={() => { setSnapId(s.id); setShowSnapChart(false) }}
                    style={{
                      fontSize: 11, padding: '2px 8px', borderRadius: 8,
                      background: s.id === activeSnap?.id ? C.primary : C.tag,
                      color: s.id === activeSnap?.id ? '#fff' : C.primary,
                    }}
                  >{s.is_baseline ? '★ ' : ''}{s.snapshot_date}{s.snapshot_time ? ` ${s.snapshot_time}` : ' 收盘'}</span>
                ))}
              </div>
            )}

            {!activeSnap && (
              <div style={{ fontSize: 11, color: '#999', lineHeight: 1.6 }}>
                这只票还没有定格快照（录入时那次评估没固化成功，或快照被删了）。用上面的日期 + 时刻补一份即可。
              </div>
            )}

            {activeSnap && (
              <div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  <Button size="mini" fill="outline" onClick={toggleSnapChart} loading={snapBusy && !snapFull}>
                    {showSnapChart ? '收起当时的图' : '看当时的 K 线 / 分时'}
                  </Button>
                  {!activeSnap.is_baseline && (
                    <Button size="mini" fill="outline" color="primary" onClick={() => markBaseline(activeSnap)}>设为基准</Button>
                  )}
                  <Button size="mini" fill="outline" color="danger" onClick={() => dropSnap(activeSnap)}>删除这份快照</Button>
                </div>

                {/* 盘中快照的失真提醒：当日 K 未收盘，量能/收盘价都会继续变 */}
                {activeSnap.kind === 'intraday' && (
                  <div style={{ background: '#FFF7E6', border: '1px solid #e6a23c', borderRadius: 8, padding: 8, fontSize: 11, color: '#8a6116', lineHeight: 1.6, marginBottom: 8 }}>
                    ⚠️ 盘中快照，当日 K 未收盘，指标存在变动风险（成交量、收盘价后面都还会变）。
                    {activeSnap.minute_scale ? `　分时精度 ${activeSnap.minute_scale} 分钟` : ''}
                    {activeSnap.actual_time && activeSnap.snapshot_time && activeSnap.actual_time !== activeSnap.snapshot_time
                      ? `　分时只截到 ${activeSnap.actual_time}（选定 ${activeSnap.snapshot_time}，之后没有成交点），量能按这个时刻折算。`
                      : ''}
                    <div>想要稳定、可复盘回测的存档，请生成不填时刻的「当日收盘快照」。</div>
                  </div>
                )}

                {/* 当时结论 + 与最新评估的差异（差异只体现在下面那块） */}
                <div style={{ background: C.light, borderRadius: 8, padding: 8, fontSize: 11, lineHeight: 1.7 }}>
                  <div>
                    当时归类 <strong style={{ color: C.primary }}>{activeSnap.pool_type || '—'} 池</strong>
                    　道氏 {DOW_TEXT[activeSnap.dow_trend] || '—'}
                    　当日涨幅 {fmt(activeSnap.today_pct)}%
                    　自动 {activeSnap.auto_score ?? '—'}/{activeSnap.max_auto_score ?? '—'}
                    　人工 {activeSnap.manual_score ?? 0}
                    　总分 {activeSnap.total_score ?? '—'}
                    {activeSnap.eliminated && <span style={{ color: C.up }}>　🚫 当时已淘汰（{activeSnap.elim_source === 'manual' ? '人工确认' : '脚本判定'}）</span>}
                  </div>
                  <div style={{ fontSize: 10, color: '#999' }}>
                    人工态来源：{activeSnap.human_from || '—'}　数据基准日 {activeSnap.data_as_of || activeSnap.snapshot_date}
                    {(activeSnap.meta?.skipped_inputs || []).length > 0 && `　当时未请求：${activeSnap.meta.skipped_inputs.join('、')}`}
                  </div>
                  {(() => {
                    const diffs = []
                    if ((activeSnap.pool_type || '') !== (pool || '')) diffs.push(`归类 ${activeSnap.pool_type || '—'} → ${pool || '—'}`)
                    if (Number(activeSnap.auto_score || 0) !== Number(autoScore || 0)) diffs.push(`自动分 ${activeSnap.auto_score ?? '—'}/${activeSnap.max_auto_score ?? '—'} → ${autoScore ?? '—'}/${maxScore ?? '—'}`)
                    if ((activeSnap.red_lines || []).length !== redLines.length) diffs.push(`红线 ${(activeSnap.red_lines || []).length} 条 → ${redLines.length} 条`)
                    if (!!activeSnap.eliminated !== !!elim.eliminated) diffs.push(`淘汰 ${activeSnap.eliminated ? '是' : '否'} → ${elim.eliminated ? '是' : '否'}`)
                    if (!diffs.length) {
                      return <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>下面「当前最新评估」结论与这份快照一致，说明后面的走势没推翻当初的判定。</div>
                    }
                    return (
                      <div style={{ fontSize: 11, color: C.primary, marginTop: 4, lineHeight: 1.6 }}>
                        <strong>与最新评估的差异：</strong>{diffs.join('；')}
                        <div style={{ fontSize: 10, color: '#999' }}>这些变化只记在下面那块动态区，这份定格存档不会跟着改。</div>
                      </div>
                    )
                  })()}
                </div>

                {/* 当时触发的红线（只读） */}
                {(activeSnap.red_lines || []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.up, marginBottom: 2 }}>🚫 当时触发红线 {(activeSnap.red_lines || []).length} 条</div>
                    {activeSnap.red_lines.map(r => (
                      <div key={r.code} style={{ fontSize: 11, lineHeight: 1.6 }}>
                        <strong style={{ color: C.up }}>{r.code}</strong>｜{r.label}
                        <div style={{ color: C.text }}>{r.detail}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* 当时的普通预警（含 B_R1 降级信息） */}
                {(snapInd.warnings || []).length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#b7791f', marginBottom: 2 }}>当时的预警（不影响淘汰）</div>
                    {(snapInd.warnings || []).map(w => (
                      <div key={w.code} style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>{w.code} {w.label}：{w.detail}</div>
                    ))}
                  </div>
                )}

                <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700 }}>当时的逐项打分（{(activeSnap.score_detail || []).length} 项，只读）</div>
                <FlatScoreList items={activeSnap.score_detail} empty="快照里没有打分明细（旧数据或脚本未返回）" />
                {activeSnap.weakest_gap && (
                  <div style={{ marginTop: 6, fontSize: 11, color: C.text, background: C.light, borderRadius: 8, padding: 8 }}>
                    <strong style={{ color: C.primary }}>当时最主要短板：</strong>{activeSnap.weakest_gap}
                    　建议持仓：{activeSnap.suggest_hold || '—'}
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '3px 10px', fontSize: 11, color: C.text, marginTop: 8 }}>
                  <div>当时现价：¥{fmt(snapInd.price)}</div>
                  <div>道氏结构：{DOW_TEXT[snapInd.dow] || '—'}</div>
                  <div>折算量/均量：{snapInd.vol_ratio_est != null ? `${Number(snapInd.vol_ratio_est).toFixed(2)} 倍` : '—'}</div>
                  <div>60 日回撤：{snapInd.retrace_pct != null ? `${Number(snapInd.retrace_pct).toFixed(1)}%` : '—'}</div>
                  <div>距 60 日低：{snapInd.dist_to_low_pct != null ? `${Number(snapInd.dist_to_low_pct).toFixed(1)}%` : '—'}</div>
                  <div>近 10 根创 60 日低：{snapInd.new_low60_count != null ? `${snapInd.new_low60_count} 次` : '—'}</div>
                  <div>阴线均量/均量：{snapInd.down_vol_ratio != null ? `${Number(snapInd.down_vol_ratio).toFixed(2)} 倍` : '—'}</div>
                  <div>当时是否盘中：{activeSnap.meta?.intraday ? `是，已交易 ${activeSnap.meta?.elapsed_trading_min ?? '—'} 分钟` : '否，按完整日 bar'}</div>
                </div>

                {/* 当时的人工判断也一起定格，事后不跟着勾选变化 */}
                <div style={{ marginTop: 8, fontSize: 11, color: C.text, lineHeight: 1.7 }}>
                  <strong style={{ color: C.primary }}>当时勾选的人工复核：</strong>
                  {(activeSnap.manual_checks || []).filter(x => x.checked).map(x => x.label).join('、') || '一项没勾'}
                  {(activeSnap.manual_checks || []).filter(x => x.checked).length > 0 ? `（人工 ${activeSnap.manual_score ?? 0} 分）` : ''}
                </div>
                {activeSnap.remark && Object.values(activeSnap.remark).some(Boolean) && (
                  <div style={{ marginTop: 2, fontSize: 11, color: C.text, lineHeight: 1.7 }}>
                    <strong style={{ color: C.primary }}>当时的备注：</strong>
                    {[
                      ['resist', '压力/目标位'],
                      ['stop_profit', '止盈止损'],
                      ['buy_plan', '买入计划'],
                      ['note', '随手记'],
                    ].map(([k, l]) => (activeSnap.remark[k] ? `${l}：${activeSnap.remark[k]}` : null)).filter(Boolean).join('　·　')}
                  </div>
                )}

                {showSnapChart && snapFull && (
                  <div style={{ marginTop: 8 }}>
                    {snapFull.kind === 'intraday' && (snapFull.minutes || []).length > 1 && (
                      <>
                        <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>
                          当时的分时（截至 {snapFull.actual_time || snapFull.snapshot_time}，{snapFull.minute_scale || 1} 分钟精度）
                        </div>
                        <MinuteChart
                          points={snapFull.minutes || []}
                          prevClose={snapPrevClose}
                          periodMin={snapFull.minute_scale || 1}
                          minutesDate={snapFull.snapshot_date}
                          name={snapFull.name || ''}
                          symbol={symbol}
                        />
                      </>
                    )}
                    <div style={{ fontSize: 11, fontWeight: 700, margin: '6px 0 4px' }}>
                      截到 {snapFull.snapshot_date} 的日 K（末根就是当时的「今日」，后面新出的 K 线不在图里）
                    </div>
                    <KlineChart kline={snapFull.kline} pool={snapFull.pool_type || pool} name={snapFull.name || ''} symbol={symbol} />
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* ==================== 区块二：🔄 当前最新评估（动态） ==================== */}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, margin: '2px 0 8px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>🔄 当前最新评估（动态）</span>
            <span style={{ fontSize: 10, color: '#999' }}>每次重跑都用最新 K 线，会被后面的走势推翻 —— 用来跟踪是否转强 / 走坏 / 触发风控，辅助做离场与调仓</span>
          </div>

          {/* 红线 */}
          {redLines.length > 0 && (
            <div style={{ background: '#FDECEC', border: `1px solid ${C.up}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.up, marginBottom: 4 }}>
                🚫 触发红线 {redLines.length} 条 —— 直接淘汰（命中任意一条即不合格）
              </div>
              {redLines.map(r => (
                <div key={r.code} style={{ fontSize: 11, lineHeight: 1.6, marginBottom: 3 }}>
                  <strong style={{ color: C.up }}>{r.code}</strong>
                  <span style={{ color: '#333' }}>｜{r.label}</span>
                  <span style={{ color: C.accent, marginLeft: 4 }}>（{r.mode === 'semi' ? '脚本预警+人工确认' : '自动判定'}）</span>
                  <div style={{ color: C.text }}>{r.detail}</div>
                </div>
              ))}
            </div>
          )}

          {/* 预警 + 接口提示 */}
          {(rowWarnings.length > 0 || metaWarnings.length > 0) && (
            <Section title="预警与接口提示" tip="这些不影响淘汰判定，但会影响某一项的数值（板块接口被限流时也会写在这里）">
              {rowWarnings.map(w => (
                <div key={w.code} style={{ fontSize: 11, color: C.text, lineHeight: 1.6 }}>
                  <span style={{ color: '#b7791f' }}>{w.code || '预警'}</span> {w.label || ''}：{w.detail || ''}
                </div>
              ))}
              {metaWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 11, color: '#b7791f', lineHeight: 1.6, marginTop: 2 }}>⚠️ {typeof w === 'string' ? w : (w.error || w.label || '')}</div>
              ))}
            </Section>
          )}

          {/* 分时 */}
          <Section
            title="今日分时"
            right={stock.minutes_date ? <span style={{ fontSize: 10, color: '#999' }}>{stock.minutes_date}　快照 {stock.spot_time || '—'}</span> : null}
            tip="新浪 1 分钟线合成（只请求 1 次）：现价线 + 累计均价线，虚线为昨收。买入时机（是否放量突破均价、封单强弱）仍需人工确认"
          >
            <MinuteChart
              points={stock.minutes || []}
              prevClose={stock.prev_close}
              periodMin={stock.minutes_period_min || 1}
              minutesDate={stock.minutes_date || ''}
              name={stock.name || ''}
              symbol={symbol}
            />
          </Section>

          {/* 日 K */}
          <Section
            title="日 K 线与规则标注"
            right={<span style={{ fontSize: 10, color: '#999' }}>{stock.kline?.dates?.length || 0} 根</span>}
            tip={stock.kline?.today_live
              ? '末根为运行时刻实时合成的未收盘 bar（虚线边框），成交量按已交易分钟折算'
              : '末根为收盘 bar（非交易时段取最新完整日线）'}
          >
            <KlineChart kline={stock.kline} pool={pool} name={stock.name || ''} symbol={symbol} />
          </Section>

          {/* 打分细则 */}
          <Section title={`打分细则（${pool} 池，共 ${scoreParts.length} 项）`}>
            {scoreParts.map(s => (
              <div key={s.code} style={{ display: 'flex', gap: 6, fontSize: 11, lineHeight: 1.6, padding: '4px 0', borderBottom: '1px dashed #f0f0f0' }}>
                <span style={{ width: 16, flexShrink: 0, color: s.met ? C.primary : '#bbb', fontWeight: 700 }}>{s.met ? '✓' : '✗'}</span>
                <div style={{ flex: 1 }}>
                  <span style={{ color: s.met ? '#333' : '#999' }}>
                    <span style={{ color: C.accent, marginRight: 4 }}>{s.code}</span>{s.label}
                  </span>
                  <div style={{ color: s.met ? C.text : '#b0a3a5' }}>{s.detail}</div>
                </div>
              </div>
            ))}
            {(stock.weakest_gap || cand?.weakest_gap) && (
              <div style={{ marginTop: 6, fontSize: 11, color: C.text, background: C.light, borderRadius: 8, padding: 8 }}>
                <strong style={{ color: C.primary }}>最主要短板：</strong>{stock.weakest_gap || cand?.weakest_gap}
              </div>
            )}
          </Section>

          {/* 关键数值 */}
          <Section title="关键数值（脚本原样输出）">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '3px 10px', fontSize: 11, color: C.text }}>
              <div>道氏结构：<strong style={{ color: C.primary }}>{DOW_TEXT[ind.dow] || '—'}</strong></div>
              <div>MA20 偏离：{ind.ma_mid_v ? `${(((ind.price - ind.ma_mid_v) / ind.ma_mid_v) * 100).toFixed(1)}%` : '—'}</div>
              <div>折算量/均量：{ind.vol_ratio_est != null ? `${Number(ind.vol_ratio_est).toFixed(2)} 倍` : '—'}</div>
              <div>累计量/均量：{ind.vol_ratio_raw != null ? `${Number(ind.vol_ratio_raw).toFixed(2)} 倍` : '—'}</div>
              <div>60 日回撤：{ind.retrace_pct != null ? `${Number(ind.retrace_pct).toFixed(1)}%` : '—'}</div>
              <div>距 60 日低：{ind.dist_to_low_pct != null ? `${Number(ind.dist_to_low_pct).toFixed(1)}%` : '—'}</div>
              <div>近 5 日创新低：{ind.new_low_count != null ? `${ind.new_low_count} 次` : '—'}</div>
              <div>放量破位距今：{ind.fresh_break_days_ago != null ? `${ind.fresh_break_days_ago} 天` : '无'}</div>
              {/* B_R1 三个条件同时成立才淘汰：持续创新低 + 放量杀跌 + 距 60 日低偏高 */}
              <div>近 10 根创 60 日低：{ind.new_low60_count != null ? `${ind.new_low60_count} 次` : '—'}</div>
              <div>阴线均量/均量：{ind.down_vol_ratio != null ? `${Number(ind.down_vol_ratio).toFixed(2)} 倍` : '—'}</div>
              <div>数据基准日：{stock.data_as_of || '—'}</div>
              <div>建议持仓：<span style={{ color: C.primary }}>{stock.suggest_hold || '—'}</span></div>
            </div>

            {stock.chip && (
              <div style={{ marginTop: 8, fontSize: 11, color: C.text, background: C.light, borderRadius: 8, padding: 8 }}>
                <strong style={{ color: C.primary }}>筹码（东财近似口径）</strong>
                　90% 上沿 {stock.chip.cost_90_upper ?? '—'}　距现价 {stock.chip.pressure_dist_pct == null ? '—' : `${stock.chip.pressure_dist_pct}%`}
                　获利比例 {stock.chip.profit_ratio == null ? '—' : `${stock.chip.profit_ratio}%`}　截至 {stock.chip.as_of || '—'}
                <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{stock.chip.source}　·　单票分析默认不请求筹码接口（避免多打一次东财），需要时在规则里打开 with_chip</div>
              </div>
            )}

            <div style={{ marginTop: 8, fontSize: 11, color: C.text, background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
              <strong style={{ color: C.primary }}>所属板块资金</strong>
              　今日净流入 {stock.fund_flow?.sector_today_net ?? '—'} 亿
              　近 5 日均 {stock.fund_flow?.sector_5d_avg_net == null ? '—' : `${stock.fund_flow.sector_5d_avg_net} 亿`}
              {stock.fund_flow?.sector_ebb != null && (
                <span style={{ color: stock.fund_flow.sector_ebb ? C.down : C.primary, marginLeft: 6 }}>
                  {stock.fund_flow.sector_ebb ? '退潮中' : '仍在流入'}
                </span>
              )}
              <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>数值为空 = 本次东财板块资金流接口没取到（限流），板块共振/退潮项按数据缺失计</div>
            </div>
          </Section>

          {/* 人工复核 */}
          <Section
            title="人工复核项（勾选即加分）"
            tip={`脚本判不了的都在这儿。每勾 1 项加 ${highlight.manualPer ?? 1} 分，上限 ${highlight.manualMax ?? 4} 分，勾完实时计入总分。`}
          >
            {data.manual_checks.length === 0 && <div style={{ fontSize: 11, color: '#999' }}>规则表里没有启用的人工复核项</div>}
            {data.manual_checks.map(m => (
              <div
                key={m.code}
                onClick={() => toggleCheck(m.code)}
                style={{
                  display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 8px', marginBottom: 4,
                  background: m.checked ? C.light : '#fff',
                  border: `1px solid ${m.checked ? C.accent : '#eee'}`, borderRadius: 8,
                }}
              >
                <span style={{ width: 16, color: m.checked ? C.primary : '#bbb', fontWeight: 700 }}>{m.checked ? '☑' : '☐'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, color: m.checked ? C.primary : '#333' }}>
                    <span style={{ color: C.accent, marginRight: 4 }}>{m.code}</span>{m.label}
                  </div>
                  {m.reason && <div style={{ fontSize: 10, color: '#999', lineHeight: 1.5 }}>{m.reason}</div>}
                </div>
              </div>
            ))}
          </Section>

          {/* 备注 */}
          <Section title="我的备注（只存打分记录，不参与打分）">
            {[
              ['resist', '压力/目标位'],
              ['stop_profit', '止盈止损计划'],
              ['buy_plan', '买入计划（分时确认）'],
              ['note', '随手记'],
            ].map(([key, label]) => (
              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px dashed #f0f0f0', padding: '4px 0' }}>
                <span style={{ fontSize: 11, color: '#999', width: 84, flexShrink: 0 }}>{label}</span>
                <Input
                  value={remark[key] || ''}
                  onChange={v => setRemark(prev => ({ ...prev, [key]: v }))}
                  placeholder="手写数值即可"
                  style={{ '--font-size': '12px', flex: 1 }}
                />
              </div>
            ))}
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <Button size="small" color="primary" fill={pick ? 'solid' : 'outline'} disabled={!cand} loading={saving} onClick={() => persist({ picked: !pick }, pick ? '已取消选中' : '已标记选中')}>
                {pick ? '★ 已选中' : '☆ 标记选中'}
              </Button>
              <Button size="small" fill="outline" disabled={!cand} loading={saving} onClick={() => persist({ remark }, '备注已保存')}>保存备注</Button>
              <Button
                size="small"
                fill="outline"
                color="danger"
                disabled={!cand || redLines.length > 0}
                loading={saving}
                onClick={() => persist(
                  { eliminated: !elim.eliminated, elim_source: elim.eliminated ? undefined : 'manual' },
                  elim.eliminated ? '已取消人工淘汰' : '已标记人工淘汰',
                )}
              >
                {redLines.length > 0 ? '红线淘汰（不可取消）' : elim.eliminated ? '取消人工淘汰' : '人工判定淘汰'}
              </Button>
            </div>
          </Section>

          <div style={{ fontSize: 10, color: '#bbb', lineHeight: 1.6, padding: '4px 6px 20px' }}>
            判定与批次打分同源（backend/scripts/fetch_money_chase.py），改「规则与参数」里的数值后这里立即跟着变。
            脚本不做自动止盈止损与下单，以上分数、标注、建议都只是筛选辅助，最终买卖由你决定。
          </div>
        </>
      )}

      {loading && !stock && (
        <div style={{ padding: '60px 0', textAlign: 'center', color: '#999', fontSize: 12, lineHeight: 2 }}>
          正在请求数据源做单票分析（日线 + 快照 + 分时各 1 次，不重试）…
        </div>
      )}
    </div>
  )
}
