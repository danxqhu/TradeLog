/**
 * 胡胖胖招财进宝 —— 第 2 页：单票在某时间点的理论打分明细
 *
 * 从主页面榜单点进来，展示这只票在所选时间点下的：
 *   道氏(50%) / 葛兰碧(50%) 逐项自动判定（✓ 成立 / ✗ 不成立 + 依据数值），
 *   加权总分与分档，以及截断到该时间点的日 K 复盘图。
 * 优先读已落库的评估（与榜单同源、秒开、0 行情请求）；没有则按需现算一次。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, DotLoading, NavBar, Toast } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'
import { fortuneApi } from '../../services/api'
import ReviewChart from './ReviewChart'
import { C, fmt } from './helpers'

const SEM_COLOR = { buy_point: '#c0392b', bonus: '#8B3A42', risk: '#e6b422', veto: '#7f8c8d' }
const SEM_TEXT = { buy_point: '买点', bonus: '加分', risk: '警示', veto: '否决' }

function ItemList({ items }) {
  return (
    <div>
      {items.map(it => (
        <div key={it.id} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid #f4f4f4', alignItems: 'flex-start' }}>
          <span style={{ width: 18, fontSize: 15, fontWeight: 900, color: it.met ? C.primary : '#c3c3c3', lineHeight: '18px' }}>{it.met ? '✓' : '✗'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: it.met ? C.text : '#999' }}>
              {it.label}
              {it.semantic && (
                <span style={{ marginLeft: 6, fontSize: 10, color: '#fff', background: SEM_COLOR[it.semantic] || '#999', borderRadius: 8, padding: '1px 6px' }}>{SEM_TEXT[it.semantic]}</span>
              )}
              <span style={{ float: 'right', fontSize: 12, color: it.met ? C.primary : '#bbb' }}>
                {Number(it.points) > 0 ? `+${it.points}` : Number(it.points) < 0 ? `${it.points}` : '否决'}
              </span>
            </div>
            <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, lineHeight: 1.4 }}>{it.detail || ''}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

export default function FortuneStock() {
  const { symbol } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const date = useMemo(() => {
    const q = new URLSearchParams(location.search).get('date') || ''
    return /^\d{4}-\d{2}-\d{2}$/.test(q) ? q : ''
  }, [location.search])
  const [name, setName] = useState(location.state?.name || '')

  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)   // { criterion_scores, weighted_total, band, dow_score, granville_score }
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { fortuneApi.getCriteria().then(r => { if (r.ok) setDoc(r.data) }) }, [])

  // 从评估记录还原明细行
  const fromEvaluation = useCallback((ev) => {
    const cs = ev.criterion_scores || {}
    const b = (doc?.bands || []).find(x => x.code === (ev.band_code || ev.band?.code))
    return {
      weighted_total: Number(ev.weighted_total),
      band: ev.band || (b ? { code: b.code, label: b.band_label || ev.band_label || b.label, color: b.color } : { label: ev.band_label || '', color: '#999' }),
      dow_score: cs.dow?.score ?? null,
      granville_score: cs.granville?.score ?? null,
      criterion_scores: cs,
    }
  }, [doc])

  const load = useCallback(async () => {
    if (!/^\d{6}$/.test(symbol || '')) return
    setLoading(true); setErr(''); setDetail(null)
    try {
      // 1) 先读该票该时间点的落库评估（秒开、0 行情请求）
      const res = await fortuneApi.listEvaluations({ symbol, date })
      if (res.ok && res.data?.length) {
        if (res.data[0].name) setName(res.data[0].name)
        setDetail(fromEvaluation(res.data[0]))
        return
      }
      // 2) 没有存档 → 按需现算一次（会拉行情）
      const r = await fortuneApi.getStockScore(symbol, date)
      if (!r.ok) { setErr(r.error || '未取得打分数据'); return }
      const d = r.data
      if (d.name) setName(d.name)
      setDetail({
        weighted_total: d.weighted_total, band: d.band,
        dow_score: d.dow_score, granville_score: d.granville_score,
        criterion_scores: d.criterion_scores,
      })
    } catch (e) {
      setErr(`加载失败：${e.message}`)
    } finally { setLoading(false) }
  }, [symbol, date, fromEvaluation])

  useEffect(() => { if (doc) load() }, [doc, load])

  // 单票「重新计算」：强制按当前/该时间点重跑
  const recompute = async () => {
    setLoading(true); setErr('')
    try {
      const r = await fortuneApi.getStockScore(symbol, date)
      if (!r.ok) { setErr(r.error || '计算失败'); setLoading(false); return }
      const d = r.data
      if (d.name) setName(d.name)
      setDetail({ weighted_total: d.weighted_total, band: d.band, dow_score: d.dow_score, granville_score: d.granville_score, criterion_scores: d.criterion_scores })
      Toast.show({ content: '已重新计算' })
    } catch (e) { Toast.show({ content: `计算失败：${e.message}` }) } finally { setLoading(false) }
  }

  const cs = detail?.criterion_scores || {}
  const dowItems = cs.dow?.items || []
  const granItems = cs.granville?.items || []
  const band = detail?.band || {}

  return (
    <div className="page-container" style={{ paddingBottom: 24 }}>
      <NavBar back={<LeftOutline />} onBack={() => navigate('/fortune')} style={{ '--border-bottom': 'none', fontWeight: 800, color: C.primary }}>
        {name || symbol} · 招财进宝打分
      </NavBar>

      {/* 总分 + 分档 */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#999' }}>{date ? `时间点 ${date}` : '当前最新'}</div>
        {loading && !detail && <div style={{ padding: 20, textAlign: 'center' }}><DotLoading color={C.primary} /></div>}
        {err && <div style={{ padding: 12, fontSize: 12, color: C.accent }}>{err}　<Button size="mini" fill="outline" onClick={recompute}>重试</Button></div>}
        {detail && (
          <div style={{ background: C.light, borderRadius: 10, padding: 12, borderLeft: `4px solid ${band.color || C.primary}`, marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: C.primary, lineHeight: 1 }}>{fmt(detail.weighted_total, 1)}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: band.color || C.primary }}>{band.label || '—'}</span>
              <div style={{ flex: 1 }} />
              <Button size="mini" fill="outline" style={{ '--border-color': C.accent, '--text-color': C.accent }} loading={loading} onClick={recompute}>重新计算</Button>
            </div>
            <div style={{ display: 'flex', gap: 14, marginTop: 8 }}>
              <span style={{ fontSize: 12, color: C.text }}>道氏 <b style={{ color: C.primary }}>{detail.dow_score == null ? '—' : Math.round(detail.dow_score)}</b><span style={{ color: '#bbb' }}>×50%</span></span>
              <span style={{ fontSize: 12, color: C.text }}>葛兰碧 <b style={{ color: C.primary }}>{detail.granville_score == null ? '—' : Math.round(detail.granville_score)}</b><span style={{ color: '#bbb' }}>×50%</span></span>
              {cs.granville?.linkage?.veto && <span style={{ fontSize: 11, color: '#7f8c8d' }}>（G6 否决：均线拐头向下）</span>}
            </div>
            {band.advice && <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{band.advice}</div>}
          </div>
        )}
      </Card>

      {/* 道氏明细 */}
      <Card title="道氏理论 · 逐项判定" style={{ marginBottom: 8 }}>
        {dowItems.length ? <ItemList items={dowItems} /> : <div style={{ fontSize: 12, color: '#bbb' }}>{loading ? '计算中…' : '暂无明细'}</div>}
      </Card>

      {/* 葛兰碧明细 */}
      <Card title="葛兰碧八大法则 · 逐项判定" style={{ marginBottom: 8 }}>
        {granItems.length ? <ItemList items={granItems} /> : <div style={{ fontSize: 12, color: '#bbb' }}>{loading ? '计算中…' : '暂无明细'}</div>}
      </Card>

      {/* K 线复盘 */}
      <ReviewChart symbol={symbol} name={name} asOfDate={date} />
    </div>
  )
}
