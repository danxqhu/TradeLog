/**
 * 胡胖胖招财进宝 —— 主页面（批量自动打分榜单）
 *
 * 用法：这里是你主观选好的股票清单；选定一个「时间点」（默认今天，可选历史交易日复盘），
 * 点「开始打分」→ 后端复用追资金指标流水线，对每只票自动折算 道氏(50%) + 葛兰碧(50%) 得分，
 * 按加权总分从高到低排序，方便快速挑最高分的票。点某一行进入第 2 页看该票当时的逐项明细与 K 线。
 *
 * 打分口径随时间点定格：历史日期用追资金 snapshot（收盘截断），当天用 live score。
 * 结果会落库，切换日期时优先读已存榜单（秒开、0 行情请求），需要更新再点「开始打分」。
 * 颜色遵循项目酒红色系（#8B3A42）。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Dialog, Empty, Input, ProgressBar, Toast } from 'antd-mobile'
import { fortuneApi, stockApi } from '../../services/api'
import CriteriaConfig from './CriteriaConfig'
import { C, fmt, todayStr } from './helpers'

// 把「扫描结果行」或「落库评估行」归一成表格行
function toRow(r, bands) {
  const cs = r.criterion_scores || {}
  const bandCode = r.band?.code || r.band_code || ''
  const b = (bands || []).find(x => x.code === bandCode)
  return {
    symbol: r.symbol,
    name: r.name || '',
    total: Number(r.weighted_total ?? r.total ?? 0),
    dow: r.dow_score ?? cs.dow?.score ?? null,
    gran: r.granville_score ?? cs.granville?.score ?? null,
    band: r.band || (b ? { code: b.code, label: r.band_label || b.label, color: b.color, advice: b.advice } : { code: bandCode, label: r.band_label || '', color: '#999', advice: '' }),
    data_as_of: r.data_as_of || r.eval_date || '',
  }
}

export default function Fortune() {
  const navigate = useNavigate()
  const [doc, setDoc] = useState(null)
  const [stocks, setStocks] = useState([])
  const [showConfig, setShowConfig] = useState(false)

  const [evalDate, setEvalDate] = useState(todayStr())
  const [rows, setRows] = useState([])
  const [errors, setErrors] = useState([])

  // 打分任务
  const [scanId, setScanId] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  const pollRef = useRef(null)

  // 股票池搜索（接系统股票库）
  const [poolKw, setPoolKw] = useState('')
  const [poolHits, setPoolHits] = useState([])
  const [searching, setSearching] = useState(false)

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
      const bands = (await fortuneApi.getCriteria()).data?.bands || []
      setRows((res.data || []).map(r => toRow(r, bands)))
    }
  }, [])

  useEffect(() => { loadBoard(evalDate) }, [evalDate, loadBoard])

  // 轮询扫描进度
  useEffect(() => {
    if (!scanId) return
    const tick = async () => {
      const res = await fortuneApi.getScanStatus(scanId)
      if (!res.ok) { setScanning(false); setScanId(null); Toast.show({ content: res.error || '打分任务丢失' }); return }
      const d = res.data
      setProgress(d.progress || 0); setStage(d.stage || '')
      if (d.status === 'done') {
        setRows((d.result || []).map(r => toRow(r, doc?.bands)))
        setErrors(d.errors || [])
        setScanning(false); setScanId(null); setProgress(100)
        Toast.show({ content: `打分完成：${(d.result || []).length} 只` })
      } else if (d.status === 'failed') {
        setScanning(false); setScanId(null)
        Toast.show({ content: d.error || '打分失败' })
      }
    }
    tick()
    pollRef.current = setInterval(tick, 1500)
    return () => clearInterval(pollRef.current)
  }, [scanId]) // eslint-disable-line

  const startScan = async () => {
    if (!stocks.length) return Toast.show({ content: '先在股票池添加你今天选中的票' })
    setErrors([])
    const res = await fortuneApi.startScan(stocks.map(s => ({ symbol: s.symbol, name: s.name })), evalDate)
    if (!res.ok) return Toast.show({ content: res.error || '发起打分失败' })
    setScanning(true); setProgress(0); setStage('准备'); setScanId(res.data.scanId)
  }

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
  }
  const removePoolStock = (s) => {
    Dialog.confirm({
      content: `从股票池移除 ${s.name || s.symbol}？（不影响已保存的评分）`,
      onConfirm: async () => { await fortuneApi.removeStock(s.symbol); await loadStocks(); Toast.show({ content: '已移除' }) },
    })
  }

  const openDetail = (r) => navigate(`/fortune/stock/${r.symbol}?date=${evalDate}`, { state: { name: r.name } })

  const bandLegend = useMemo(() => doc?.bands || [], [doc])

  return (
    <div className="page-container" style={{ paddingBottom: 24 }}>
      {/* 标题 + 说明 + 配置 */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: C.primary, flex: 1 }}>🧧 招财进宝 · 今日选股打分</div>
          <Button size="small" fill="outline" style={{ '--border-color': C.accent, '--text-color': C.accent }} onClick={() => setShowConfig(true)}>权重配置</Button>
        </div>
        <div style={{ fontSize: 11, color: '#999', marginTop: 6, lineHeight: 1.5 }}>
          清单是你主观选好的票；这里只自动跑 <b>道氏 {doc?.criteria?.find(c => c.code === 'dow' && c.enabled)?.weight ?? 50}% + 葛兰碧 {doc?.criteria?.find(c => c.code === 'granville' && c.enabled)?.weight ?? 50}%</b>，按加权总分排序。
        </div>
      </Card>

      {/* 时间点 + 股票池 */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: '#666', whiteSpace: 'nowrap' }}>时间点(可选历史)</span>
          <input type="date" value={evalDate} onChange={(e) => setEvalDate(e.target.value)}
            style={{ flex: 1, fontSize: 13, padding: '4px 8px', borderRadius: 8, border: `1px solid ${C.tag}`, color: C.primary }} />
        </div>

        <div style={{ fontSize: 12, color: '#666', marginBottom: 6 }}>股票池（今日清单 {stocks.length} 只）</div>
        {stocks.length === 0 && <Empty description="搜代码/名称，把你今天选中的票加进来" style={{ padding: '6px 0' }} />}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: stocks.length ? 8 : 0 }}>
          {stocks.map(s => (
            <span key={s.symbol} style={{
              fontSize: 12, padding: '4px 10px', borderRadius: 14, cursor: 'pointer',
              background: C.light, color: C.primary, border: `1px solid ${C.tag}`,
            }}>
              {s.name || s.symbol} <span style={{ opacity: 0.7 }}>{s.symbol}</span>
              <span onClick={() => removePoolStock(s)} style={{ marginLeft: 4, opacity: 0.6 }}>×</span>
            </span>
          ))}
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
            {!searching && poolHits.length === 0 && <div style={{ padding: 8, fontSize: 12, color: '#bbb' }}>股票库无匹配（可点“加入”直接录代码）</div>}
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

        <Button block color="primary" loading={scanning} style={{ '--background-color': C.primary, '--border-color': C.primary, marginTop: 10 }}
          onClick={startScan}>{scanning ? '打分进行中…' : `开始打分 · 道氏+葛兰碧（${stocks.length} 只）`}</Button>
        {scanning && (
          <div style={{ marginTop: 8 }}>
            <ProgressBar percent={progress} style={{ '--fill-color': C.primary }} />
            <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>{stage || '准备中…'}</div>
          </div>
        )}
      </Card>

      {/* 打分榜单 */}
      <Card title={`打分榜单 · ${evalDate}`} style={{ marginBottom: 8 }}>
        {rows.length === 0 && !scanning && <Empty description="还没有评分，点上方「开始打分」" style={{ padding: '10px 0' }} />}
        {rows.length > 0 && (
          <>
            <div style={{ display: 'flex', fontSize: 11, color: '#999', padding: '0 4px 6px', borderBottom: `1px solid ${C.tag}` }}>
              <span style={{ width: 26 }}>#</span>
              <span style={{ flex: 1 }}>名称 / 代码</span>
              <span style={{ width: 44, textAlign: 'right' }}>道氏</span>
              <span style={{ width: 50, textAlign: 'right' }}>葛兰碧</span>
              <span style={{ width: 48, textAlign: 'right' }}>总分</span>
              <span style={{ width: 56, textAlign: 'right' }}>分档</span>
            </div>
            {rows.map((r, i) => (
              <div key={r.symbol} onClick={() => openDetail(r)}
                style={{ display: 'flex', alignItems: 'center', padding: '9px 4px', borderBottom: '1px solid #f4f4f4', cursor: 'pointer' }}>
                <span style={{ width: 26, fontSize: 12, color: i < 3 ? C.primary : '#bbb', fontWeight: i < 3 ? 800 : 400 }}>{i + 1}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name || r.symbol}</div>
                  <div style={{ fontSize: 10, color: '#bbb' }}>{r.symbol}{r.data_as_of ? ` · 数据到 ${r.data_as_of}` : ''}</div>
                </span>
                <span style={{ width: 44, textAlign: 'right', fontSize: 13, color: '#666' }}>{r.dow == null ? '—' : Math.round(r.dow)}</span>
                <span style={{ width: 50, textAlign: 'right', fontSize: 13, color: '#666' }}>{r.gran == null ? '—' : Math.round(r.gran)}</span>
                <span style={{ width: 48, textAlign: 'right', fontSize: 16, fontWeight: 900, color: C.primary }}>{fmt(r.total, 1)}</span>
                <span style={{ width: 56, textAlign: 'right' }}>
                  <span style={{ fontSize: 11, color: '#fff', background: r.band.color || '#999', borderRadius: 10, padding: '2px 8px' }}>{r.band.label || '—'}</span>
                </span>
              </div>
            ))}
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
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {bandLegend.map(b => (
              <span key={b.code} style={{ fontSize: 11, color: b.color, border: `1px solid ${b.color}`, borderRadius: 12, padding: '2px 10px' }}>
                {b.label} {fmt(b.min, 0)}–{b.max > 100 ? '100' : fmt(b.max, 0)}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#bbb', marginTop: 8 }}>{doc?.formula || ''}</div>
        </Card>
      )}

      <CriteriaConfig visible={showConfig} onClose={() => setShowConfig(false)} doc={doc} onSaved={(d) => { setDoc(d); setShowConfig(false) }} />
    </div>
  )
}
