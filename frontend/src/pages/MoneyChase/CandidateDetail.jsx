/**
 * 每日追资金 —— 单只候选股详情
 * 图上画不下的东西都在这里写清楚：每条打分项的判定数值、触发了哪一条红线（原文＋数值）、
 * 人工复核勾选（勾选即加分）、压力/止盈/买入计划备注。
 */
import React, { useEffect, useState } from 'react'
import { Button, Dialog, Input, Toast } from 'antd-mobile'
import { moneyChaseApi } from '../../services/api'
import KlineChart from './KlineChart'

const C = {
  primary: '#8B3A42', accent: '#C4737A', tag: '#F5E6E8', light: '#FAF0F1',
  up: '#e74c3c', down: '#27ae60', text: '#666',
}

function pctColor(v) {
  if (v == null) return '#999'
  return v > 0 ? C.up : v < 0 ? C.down : '#999'
}

export default function CandidateDetail({ item, onClose }) {
  const [detail, setDetail] = useState(null)
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState(item.manual_checks || [])
  const [remark, setRemark] = useState(item.remark || { resist: '', stop_profit: '', buy_plan: '', note: '' })
  const [saving, setSaving] = useState(false)
  // 淘汰/选中用本地态，改完立即看得见反馈（关弹窗后父级会重拉列表）
  const [elim, setElim] = useState({ eliminated: !!item.eliminated, source: item.elim_source })
  const [pick, setPick] = useState(!!item.picked)
  const [manualScore, setManualScore] = useState(item.manual_score || 0)
  const [totalScore, setTotalScore] = useState(item.total_score)

  useEffect(() => {
    setLoading(true)
    moneyChaseApi.getKline(item.id)
      .then(res => { if (res.ok) setDetail(res.data); else Toast.show({ content: res.error || '读取K线失败', icon: 'fail' }) })
      .catch(() => Toast.show({ content: '读取K线请求失败', icon: 'fail' }))
      .finally(() => setLoading(false))
  }, [item.id])

  const scoreParts = detail?.score_detail || item.score_detail || []
  const redLines = item.red_lines || detail?.red_lines || []
  const warnings = (item.indicators || {}).warnings || []
  const redElim = redLines.length > 0

  const persist = async (patch) => {
    setSaving(true)
    try {
      const res = await moneyChaseApi.updateCandidate(item.id, patch)
      if (res.ok) {
        item.manual_checks = res.data.manual_checks
        item.remark = res.data.remark
        setManualScore(res.data.manual_score)
        setTotalScore(res.data.total_score)
        setElim({ eliminated: !!res.data.eliminated, source: res.data.elim_source })
        setPick(!!res.data.picked)
        return true
      }
      Toast.show({ content: res.error || '保存失败', icon: 'fail' })
      return false
    } catch {
      Toast.show({ content: '保存请求失败', icon: 'fail' })
      return false
    } finally {
      setSaving(false)
    }
  }

  const toggleCheck = (code) => {
    const next = checks.map(x => (x.code === code ? { ...x, checked: !x.checked } : x))
    setChecks(next)
    persist({ manual_checks: next })
  }

  const setRemarkField = (key, val) => {
    const next = { ...remark, [key]: val }
    setRemark(next)
  }

  const toggleEliminate = () => {
    const willElim = !elim.eliminated
    if (willElim) {
      Dialog.confirm({
        content: '人工判定淘汰这只？该行会移到「已淘汰」区，并标注为人工淘汰。',
        onConfirm: async () => {
          const ok = await persist({ eliminated: true, elim_source: 'manual' })
          if (ok) Toast.show({ content: '已标记人工淘汰' })
        },
      })
    } else {
      persist({ eliminated: false })
      Toast.show({ content: '已取消人工淘汰' })
    }
  }

  const ind = detail?.indicators || item.indicators || {}

  return (
    <div style={{ padding: '0 12px 24px' }}>
      {/* 概要 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', padding: '6px 0 10px' }}>
        <span style={{ fontSize: 17, fontWeight: 700 }}>{item.name}</span>
        <span style={{ fontSize: 12, color: '#999' }}>{item.symbol}</span>
        <span style={{ fontSize: 12, color: pctColor(item.today_pct), fontWeight: 600 }}>
          {item.today_pct > 0 ? '+' : ''}{item.today_pct == null ? '—' : item.today_pct}%
        </span>
        <span style={{ fontSize: 11, background: C.tag, color: C.primary, padding: '1px 8px', borderRadius: 8 }}>{item.pool_type} 池</span>
        <span style={{ fontSize: 11, color: '#999' }}>{item.sector}</span>
        <span style={{ marginLeft: 'auto', fontSize: 15, fontWeight: 700, color: C.primary }}>
          {totalScore}
          <span style={{ fontSize: 11, color: '#999', fontWeight: 400 }}>/{item.max_auto_score}+人工 分</span>
        </span>
      </div>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
        自动 {item.auto_score}/{item.max_auto_score}　人工 {manualScore}　·　数据截至 {item.data_as_of || '—'}
        {item.source === 'manual_add' ? '　·　人工加入' : ''}
      </div>

      {/* 红线 */}
      {redLines.length > 0 && (
        <div style={{ background: '#FDECEC', border: `1px solid ${C.up}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.up, marginBottom: 4 }}>
            🚫 触发红线 {redLines.length} 条 —— 直接淘汰（红线任一命中即不合格）
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
      {elim.source === 'manual' && (
        <div style={{ background: '#f7f7f7', borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 11, color: C.text }}>
          本票由人工标记淘汰（脚本未判出红线）
        </div>
      )}

      {/* 预警（可选规则，不淘汰） */}
      {warnings.length > 0 && (
        <div style={{ background: '#FFF8E6', borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 11 }}>
          <strong style={{ color: '#b7791f' }}>⚠️ 预警（不影响分数与淘汰）</strong>
          {warnings.map(w => (
            <div key={w.code} style={{ color: C.text, marginTop: 3 }}>{w.code} {w.label}：{w.detail}</div>
          ))}
        </div>
      )}

      {/* K 线 */}
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
          日 K 线（{detail?.kline?.dates?.length || 0} 根，{detail?.kline?.today_live ? '末根为运行时刻实时合成的未收盘 bar' : '末根为收盘 bar'}）
        </div>
        {loading ? (
          <div style={{ height: 200, textAlign: 'center', color: '#999', fontSize: 12, paddingTop: 80 }}>K 线加载中…</div>
        ) : (
          <KlineChart kline={detail?.kline} pool={item.pool_type} name={item.name} symbol={item.symbol} />
        )}
      </div>

      {/* 打分逐项 */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6 }}>打分细则（{item.pool_type} 池，共 {scoreParts.length} 项）</div>
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
        {item.weakest_gap && (
          <div style={{ marginTop: 6, fontSize: 11, color: C.text, background: C.light, borderRadius: 8, padding: 8 }}>
            <strong style={{ color: C.primary }}>最主要短板：</strong>{item.weakest_gap}
          </div>
        )}
      </div>

      {/* 人工复核项 */}
      {checks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>人工复核项（勾选即加分，脚本判不了的都在这）</div>
          <div style={{ fontSize: 10, color: '#999', marginBottom: 6 }}>
            每勾 1 项加分值见规则表 manual_score_per_item，总和有人工分上限
          </div>
          {checks.map(m => (
            <div
              key={m.code}
              onClick={() => toggleCheck(m.code)}
              style={{
                display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 8px', marginBottom: 4,
                background: m.checked ? C.light : '#fff', border: `1px solid ${m.checked ? C.accent : '#eee'}`, borderRadius: 8,
              }}
            >
              <span style={{ width: 16, color: m.checked ? C.primary : '#bbb', fontWeight: 700 }}>{m.checked ? '☑' : '☐'}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: m.checked ? C.primary : '#333' }}>
                  <span style={{ color: C.accent, marginRight: 4 }}>{m.code}</span>{m.label}
                </div>
                <div style={{ fontSize: 10, color: '#999', lineHeight: 1.5 }}>{m.reason}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 关键数值 */}
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>关键数值（脚本原样输出）</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '3px 10px', fontSize: 11, color: C.text }}>
          <div>道氏结构：<strong style={{ color: C.primary }}>{ind.dow === 'UP' ? '上升' : ind.dow === 'DOWN' ? '下降' : '震荡'}</strong></div>
          <div>MA20 偏离：{ind.ma_mid_v ? `${(((ind.price - ind.ma_mid_v) / ind.ma_mid_v) * 100).toFixed(1)}%` : '—'}</div>
          <div>折算量/均量：{ind.vol_ratio_est != null ? `${Number(ind.vol_ratio_est).toFixed(2)} 倍` : '—'}</div>
          <div>累计量/均量：{ind.vol_ratio_raw != null ? `${Number(ind.vol_ratio_raw).toFixed(2)} 倍` : '—'}</div>
          <div>60 日回撤：{ind.retrace_pct != null ? `${Number(ind.retrace_pct).toFixed(1)}%` : '—'}</div>
          <div>距 60 日低：{ind.dist_to_low_pct != null ? `${Number(ind.dist_to_low_pct).toFixed(1)}%` : '—'}</div>
          <div>近 5 日创新低：{ind.new_low_count != null ? `${ind.new_low_count} 次` : '—'}</div>
          <div>放量破位距今：{ind.fresh_break_days_ago != null ? `${ind.fresh_break_days_ago} 天` : '无'}</div>
          <div>数据基准日：{item.data_as_of || '—'}</div>
          <div>建议持仓：<span style={{ color: C.primary }}>{item.suggest_hold || '—'}</span></div>
        </div>

        {item.chip && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.text, background: C.light, borderRadius: 8, padding: 8 }}>
            <strong style={{ color: C.primary }}>筹码（东财近似口径）</strong>
            　90% 上沿 {item.chip.cost_90_upper ?? '—'}　距现价 {item.chip.pressure_dist_pct == null ? '—' : `${item.chip.pressure_dist_pct}%`}
            　获利比例 {item.chip.profit_ratio == null ? '—' : `${item.chip.profit_ratio}%`}　截至 {item.chip.as_of || '—'}
            <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>{item.chip.source}</div>
          </div>
        )}

        {item.fund_flow && (
          <div style={{ marginTop: 8, fontSize: 11, color: C.text, background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: 8 }}>
            <strong style={{ color: C.primary }}>所属板块资金</strong>
            　今日净流入 {item.fund_flow.sector_today_net ?? '—'} 亿
            　近 5 日均 {item.fund_flow.sector_5d_avg_net == null ? '—' : `${item.fund_flow.sector_5d_avg_net} 亿`}
            {item.fund_flow.sector_ebb != null && (
              <span style={{ color: item.fund_flow.sector_ebb ? C.down : C.primary, marginLeft: 6 }}>
                {item.fund_flow.sector_ebb ? '退潮中' : '仍在流入'}
              </span>
            )}
            <div style={{ fontSize: 10, color: '#999', marginTop: 2 }}>板块资金主线是否持续，仍需你在同花顺确认（人工复核项）</div>
          </div>
        )}
      </div>

      {/* 人工备注 */}
      <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 10, padding: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>我的备注（只存本地记录，不参与打分）</div>
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
              onChange={v => setRemarkField(key, v)}
              placeholder={key === 'note' ? '分时是否配合、封单强弱等' : '手写数值即可'}
              style={{ '--font-size': '12px', flex: 1 }}
            />
          </div>
        ))}
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Button size="mini" color="primary" loading={saving} onClick={() => persist({ remark }).then(ok => ok && Toast.show({ content: '备注已保存', icon: 'success' }))}>
            保存备注
          </Button>
        </div>
      </div>

      {/* 操作 */}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          block
          size="small"
          fill={pick ? 'solid' : 'outline'}
          color="primary"
          onClick={() => persist({ picked: !pick }).then(ok => ok && Toast.show({ content: pick ? '已取消选中' : '已加入我的自选标记' }))}
        >
          {pick ? '★ 已选中' : '☆ 标记选中'}
        </Button>
        <Button
          block
          size="small"
          fill="outline"
          color="danger"
          disabled={redElim}
          onClick={toggleEliminate}
        >
          {redElim ? '红线淘汰（不可取消）' : elim.eliminated ? '取消人工淘汰' : '人工判定淘汰'}
        </Button>
        <Button block size="small" fill="none" onClick={onClose}>关闭</Button>
      </div>
      <div style={{ fontSize: 10, color: '#bbb', marginTop: 8, lineHeight: 1.6 }}>
        脚本不做自动止盈止损与下单，以上分数、标注、建议都只是筛选辅助，最终买卖由你决定。
      </div>
    </div>
  )
}
