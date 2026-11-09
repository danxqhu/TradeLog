/**
 * 胡胖胖招财进宝 —— 判定项评分面板
 *
 * 每个启用的判定项一张卡：勾选成立的子项 → 该项自动折算 0-100 分；
 * 也可「手动改分」直接覆盖分数（主观项或想强/弱化某项时用）。
 * 葛兰碧子项带语义标签（buy_point/bonus/risk/veto），只做视觉区分，基础版仍人工勾选。
 */
import React from 'react'
import { C, fmt, criterionScore } from './helpers'

const SEMANTIC = {
  buy_point: { t: '买点', c: '#c0392b' },
  bonus: { t: '加分', c: '#27ae60' },
  risk: { t: '风险', c: '#e6b422' },
  veto: { t: '否决', c: '#8B3A42' },
}

function CriterionCard({ criterion, state, onChange }) {
  const checked = new Set(state?.checked || [])
  const score = criterionScore(criterion, state || { checked: [] })
  const override = state?.scoreOverride

  const toggle = (id) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(criterion.code, { ...state, checked: [...next], scoreOverride: null })
  }

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: '10px 12px', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: C.primary }}>{criterion.name}</span>
        <span style={{ fontSize: 11, color: C.accent, background: C.tag, borderRadius: 10, padding: '1px 8px' }}>权重 {fmt(criterion.weight, 0)}%</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: '#999' }}>得分</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: C.primary }}>{score}</span>
        <span style={{ fontSize: 10, color: '#bbb' }}>→ 加权 {fmt(score * criterion.weight / 100)}</span>
      </div>

      {criterion.description && (
        <div style={{ fontSize: 10, color: '#999', margin: '4px 0 6px', lineHeight: 1.5 }}>{criterion.description}</div>
      )}

      {(criterion.items || []).map(it => {
        const on = checked.has(it.id)
        const sem = SEMANTIC[it.semantic]
        const pts = Number(it.points) || 0
        return (
          <div
            key={it.id}
            onClick={() => toggle(it.id)}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer',
              background: on ? C.light : '#fafafa', border: `1px solid ${on ? C.accent : '#eee'}`, marginBottom: 4,
            }}
          >
            <span style={{
              width: 16, height: 16, lineHeight: '16px', textAlign: 'center', borderRadius: 4, flexShrink: 0, marginTop: 1,
              background: on ? C.primary : '#fff', color: on ? '#fff' : '#ccc', border: `1px solid ${on ? C.primary : '#ccc'}`, fontSize: 11,
            }}>{on ? '✓' : ''}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: on ? C.primary : '#444', fontWeight: on ? 600 : 500 }}>
                {sem && <span style={{ fontSize: 9, color: '#fff', background: sem.c, borderRadius: 4, padding: '0 4px', marginRight: 6 }}>{sem.t}</span>}
                {it.label}
              </div>
              {(it.desc || it.formula) && (
                <div style={{ fontSize: 10, color: '#999', marginTop: 2, lineHeight: 1.4 }}>{it.desc || it.formula}</div>
              )}
            </div>
            <span style={{ fontSize: 11, color: pts >= 0 ? C.accent : '#e6b422', flexShrink: 0 }}>{pts > 0 ? `+${pts}` : pts}</span>
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
        <span style={{ fontSize: 10, color: '#999' }}>手动改分（覆盖勾选折算）：</span>
        <input
          type="number" min="0" max="100" value={override ?? ''} placeholder="留空=按勾选"
          onChange={(e) => onChange(criterion.code, { ...state, scoreOverride: e.target.value === '' ? null : Number(e.target.value) })}
          style={{ width: 90, fontSize: 12, padding: '2px 6px', borderRadius: 6, border: `1px solid ${C.tag}`, color: C.primary }}
        />
        {override !== null && override !== undefined && override !== '' && (
          <span onClick={() => onChange(criterion.code, { ...state, scoreOverride: null })} style={{ fontSize: 10, color: C.accent, cursor: 'pointer' }}>清除</span>
        )}
      </div>
    </div>
  )
}

export default function ScorePanel({ criteria, scoreStates, onChange }) {
  const active = criteria.filter(c => c.enabled)
  if (!active.length) return <div style={{ fontSize: 12, color: '#999', padding: 12 }}>没有启用的判定项，请到「判定项配置」里添加或开启。</div>
  return (
    <div>
      {active.map(c => (
        <CriterionCard key={c.code} criterion={c} state={scoreStates[c.code]} onChange={onChange} />
      ))}
    </div>
  )
}
