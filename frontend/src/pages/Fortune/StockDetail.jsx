/**
 * 胡胖胖招财进宝 —— 第 2 页：单票在某时间点的打分明细（v4.0）
 *
 * 从主页面榜单点进来，顶部是三个基础分 + 两套综合分五张卡：
 *   A_score 买入分（M1~M8 模块加权）· B_score 超跌反转分（B1~B7）· W_score 衰竭止盈分（W1~W8）
 *   S_A = A×wA − W×wB、S_B = B×wA − W×wB（钳位后平移为 0～100，只用于榜单排序）
 * 下面按【判定项配置】循环渲染模块卡片（M1 道氏 / M2 葛兰碧 / M3 量价 /
 * M4 均线 / M5 DMI / M6 斐波那契 / M7 箱体 / M8 蜡烛……新增模块不需改本页代码），每张卡展示：
 *   模块原始分[0-100] + 权重 + 对总分贡献值 + 逐条判定明细（✓ 成立 / ⚠ 风险 / ✗ 不成立 + 依据数值）。
 * B 卡逐子项额外展示理论来源与筹码原始摘要；B7 只认筹码接口真实数据，未拉取/失败都记 0 并标注来源。
 * 旁列 A/B 池趋势标签与均线排列标签（只作展示，不参与总分）。
 * 优先读已落库的评估（与榜单同源、秒开、0 行情请求）；没有则按需现算一次，重算可选「含真实筹码」。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Button, Card, DotLoading, NavBar, Toast } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'
import { fortuneApi } from '../../services/api'
import ReviewChart from './ReviewChart'
import { C, fmt } from './helpers'

// 子项类型徽标：累加型模块的正向项（配置里 type=positive）与买点同色，风险项用警示色
const TYPE_COLOR = { buy_point: '#8B3A42', positive: '#8B3A42', risk: '#e6b422' }
const TYPE_TEXT = { buy_point: '买点', positive: '正向', risk: '风险' }
// 本轮打分口径：粗筛（未请求筹码）/ 精选（已补 B7）/ 历史定格 / 单票含筹码
const STAGE_LABEL = { pre_filter: '粗筛', select: '精选', history: '历史定格', single: '含筹码' }

// 降级标记（旧数据无 degraded 字段时不显示）
function DegradedTag({ on }) {
  if (!on) return null
  return <span style={{ marginLeft: 4, fontSize: 9, color: '#c0392b', background: '#fdeaea', borderRadius: 6, padding: '0 4px' }}>数据降级近似判定</span>
}

function ItemList({ items }) {
  return (
    <div>
      {items.map(it => {
        const isRisk = (it.type === 'risk') || Number(it.points) < 0
        const positive = Number(it.points) > 0
        // blocked：结构判定本身成立，但因整组前置未达 / 该组开关关闭而不计分（与「没成立」区分开）
        const blocked = !it.met && (it.blocked || it.hit)
        return (
          <div key={it.id} style={{ display: 'flex', gap: 8, padding: '8px 0', borderBottom: '1px solid #f4f4f4', alignItems: 'flex-start' }}>
            <span style={{ width: 18, fontSize: 15, fontWeight: 900, lineHeight: '18px', color: it.met ? (isRisk ? '#e6b422' : C.primary) : (blocked ? C.accent : '#c3c3c3') }}>
              {it.met ? (isRisk ? '⚠' : '✓') : (blocked ? '⊘' : '✗')}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: it.met ? C.text : '#999' }}>
                <span style={{ marginRight: 6, fontSize: 11, color: '#bbb' }}>{it.id}</span>
                {it.label}
                {it.type && TYPE_TEXT[it.type] && (
                  <span style={{ marginLeft: 6, fontSize: 10, color: '#fff', background: TYPE_COLOR[it.type] || '#999', borderRadius: 8, padding: '1px 6px' }}>{TYPE_TEXT[it.type]}</span>
                )}
                <DegradedTag on={it.degraded} />
                <span style={{ float: 'right', fontSize: 12, color: it.met ? C.primary : (blocked ? C.accent : '#bbb') }}>
                  {it.met ? (positive ? `+${it.points}` : `${it.points}`) : (blocked ? '不计分' : (isRisk ? '0' : '+0'))}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, lineHeight: 1.4 }}>{it.detail || ''}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** facts 键 → 中文标签（未登记的键原样显示，后端加字段时不必同步改页面）*/
const FACT_LABEL = {
  window: '窗口', vol_ma_period: '均量周期', mav: 'MAV均量', prev_high: '阶段前高', vol_at_prev_high: '前高量',
  volume: '当日量', vol_ratio: '量比',
  ma_short_period: '短均线周期', ma_long_period: '长均线周期', slope_bars: '斜率根数',
  ma_short: '短均线', ma_short_prev: '短均线前值', ma_long: '长均线', ma_long_prev: '长均线前值',
  close: '收盘', gap_pct: '间距%', arrange: '排列',
  adx: 'ADX', pdi: 'PDI', mdi: 'MDI', period: '周期',
  wave_high: '波段高', wave_low: '波段低', range: '波段幅', direction: '波段', lookback: '回看根数',
  nearest_level: '最近档', nearest_deviation_pct: '偏离%',
  box_top: '箱体上沿', box_bottom: '箱体下沿', mid: '中轨', amp_pct: '振幅%', min_amp_pct: '最小振幅%',
  open: '开盘', high: '最高', low: '最低', prev_open: '昨开', prev_close: '昨收',
  body: '实体', upper_shadow: '上影', lower_shadow: '下影', body_pos: '实体位置', trend_pct: '近根累计%',
  // 超跌反转（B）与筹码
  bias_pct: '乖离%', ma_ref: '参照均线', slope_prev_pct: '前段斜率%/根', slope_now_pct: '近段斜率%/根',
  stage_low: '阶段低点', flat_low: '近两根最低', swing_low_a: '前低', swing_low_b: '后低',
  dif_a: '前低 DIF', dif_b: '后低 DIF', bars_a: '前低位置', bars_b: '后低位置',
  shrink_vol_ratio: '缩量均量比', bear_bars: '阴线条数', today_vol: '今日量', break_high: '突破前高',
  dist_to_low_pct: '距 60 日低%', low_zone_pct: '低位阈值%', patterns: '命中形态',
  boll_lower: '布林下轨', boll_mid: '中轨', std: '标准差', touch_bars: '触及根数',
  profit_pct: '获利比例%', pressure_dist_pct: '成本上沿距现价%', cost_90_upper: '90%成本上沿', as_of: '筹码交易日', api: '筹码接口',
}

function factValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v.toLocaleString() : String(v)
  return String(v)
}

/** 模块判定用到的原始数值（只展示，不算分）*/
function FactsLine({ facts }) {
  const keys = Object.keys(facts || {}).filter(k => ['number', 'string'].includes(typeof facts[k]) && facts[k] !== '')
  if (!keys.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 10px', marginTop: 8, padding: '5px 8px', background: '#fafafa', borderRadius: 8, fontSize: 10, color: '#aaa' }}>
      {keys.map(k => (
        <span key={k}>{FACT_LABEL[k] || k} <b style={{ color: '#888', fontWeight: 600 }}>{factValue(facts[k])}</b></span>
      ))}
    </div>
  )
}

/** 分档型模块（DMI / 斐波那契 / 箱体 / 蜡烛）：命中档高亮，其余档位灰显，方便看出为何给这个分 */
function TierList({ items, note }) {
  const hit = items.find(x => x.met)
  return (
    <div>
      {items.map(it => (
        <div key={it.id} style={{ display: 'flex', gap: 8, padding: '7px 0', borderBottom: '1px solid #f4f4f4', alignItems: 'flex-start', opacity: it.met ? 1 : 0.45 }}>
          <span style={{ width: 18, fontSize: 13, lineHeight: '18px', color: it.met ? C.primary : '#c3c3c3' }}>{it.met ? '●' : '○'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: it.met ? 700 : 500, color: it.met ? C.text : '#999' }}>
              <span style={{ marginRight: 6, fontSize: 11, color: '#bbb' }}>{it.id}</span>
              {it.label}
              <span style={{ float: 'right', fontSize: 12, color: it.met ? C.primary : '#bbb' }}>{it.points}</span>
            </div>
            {it.detail && <div style={{ fontSize: 11, color: '#aaa', marginTop: 2, lineHeight: 1.4 }}>{it.detail}</div>}
          </div>
        </div>
      ))}
      {!hit && <div style={{ fontSize: 11, color: '#bbb', marginTop: 4 }}>{note || '本次未命中任何档位'}</div>}
    </div>
  )
}

/**
 * 把 criterion_scores + 判定项配置 + 总分明细行拼成模块卡片数据（评估读档与现算两条路径同构）：
 *  — 启用且算过的模块计入总分；
 *  — 关闭但算过的（如 M8 蜡烛、权重 0）照样出卡片，只标「仅提示，不计入总分」；
 *  — 算不到（unavailable / 历史数据无该模块）时分数为空，并说明其权重已从分母剔除。
 */
function buildModules(cs, criteria, details) {
  const rows = (criteria || []).map(c => ({ ...c, inCfg: true }))
  for (const code of Object.keys(cs || {})) {
    const v = cs[code] || {}
    if (v.sell || v.reversal) continue   // 衰竭 W 组与反转 B 组各走自己的卡，不进买入模块卡
    if (!rows.some(c => c.code === code)) rows.push({ code, name: code, type: 'auto', weight: 0, enabled: false, items: [], inCfg: false })
  }
  // 整批新模块的 key 一个都不在存档里 → 该条记录落库于多模块上线之前（重新打分即可补齐），不是本次判定失败
  const autoCodes = (criteria || []).filter(c => c.type === 'auto' && c.code !== 'dow' && c.code !== 'granville' && c.code !== 'manual')
  const legacyRecord = autoCodes.length > 0 && autoCodes.every(c => !(cs || {})[c.code])
  const out = []
  for (const c of rows) {
    const e = cs ? cs[c.code] : undefined
    const has = !!e
    if (!c.enabled && !has) continue
    if (c.type !== 'auto') continue   // 主观判定项没有自动逐条明细，不进模块卡
    const items = Array.isArray(e?.items) ? e.items : []
    const score = (has && e.score !== null && e.score !== undefined) ? Number(e.score) : null
    const available = has ? (e.unavailable === true ? false : (e.available === undefined ? score !== null : !!e.available)) : false
    // 权重以当前配置为准（关掉/未计入的模块也要显它的预置权重）；配置里没这个 code 才用存档值
    const weight = Number(c.inCfg ? c.weight : (e?.weight ?? c.weight)) || 0
    const d = (details || []).find(x => x.code === c.code) || null
    const counted = has ? (e.counted !== undefined ? !!e.counted : (!!c.enabled && available)) : false
    const contribution = typeof e?.contribution === 'number' ? e.contribution : Number(d?.contribution || 0)
    // 未存档时分两种：整批都没 → 旧记档；仅本模块没 → 脚本本次未返回/数据不足
    const absentNote = legacyRecord
      ? '这条评分存档于多模块上线之前，只含道氏 + 葛兰碧（当时按 50/50 计），点「重新计算」即可补齐本模块'
      : '本次未取到该模块判定（脚本未返回 fortune_modules），权重已从总分分母剔除'
    out.push({
      code: c.code, name: c.name, weight, score, available, counted, contribution, items,
      state: (has && e.state) || '', facts: (has && e.facts) || null,
      state_label: (has && e.state_label) || '',
      legacy: !has && legacyRecord,
      note: (has && e.note) || (d && d.note) || (available ? '' : absentNote),
    })
  }
  return out
}

/** 收起时的说明按卡内内容措辞，不致于所有卡都只写一句「明细已收起」 */
function foldedWord(items, isTier) {
  const n = (items || []).length
  if (!n) return '本模块无子项明细'
  const risk = (items || []).filter(x => x.type === 'risk' || Number(x.points) < 0).length
  const word = isTier ? `分档判定 ${n} 档` : (risk ? `买点与风险项 ${n} 条` : `结构判定 ${n} 条`)
  return `${word}已收起，点标题行展开`
}

/** 单个模块卡片：卡头「▸/▾ + 模块名 + code」，收起时只给分数摘要，展开后卡体为判定明细 */
function ModuleCard({ m }) {
  const isTier = m.items.some(x => x.type === 'tier')
  // 参与总分且拿到判定数据的模块（如 M1～M4）默认展开；仅提示 / 本次未启用的默认收起
  const [open, setOpen] = useState(!!(m.counted && m.available))
  return (
    <Card
      style={{ marginBottom: 8 }}
      onHeaderClick={() => setOpen(v => !v)}
      headerStyle={{ cursor: 'pointer' }}
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.primary, width: 11, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: m.counted ? C.primary : '#aaa' }}>{m.name}</span>
          <span style={{ fontSize: 10, color: '#bbb' }}>{m.code}</span>
          {!m.counted && (
            <span style={{ fontSize: 10, color: '#8a6d3b', background: '#f6f1e2', borderRadius: 8, padding: '1px 6px' }}>仅提示，不计入总分</span>
          )}
          {m.state_label && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: C.primary, border: `1px solid ${C.tag}`, borderRadius: 8, padding: '1px 6px' }}>{m.state_label}</span>
          )}
        </div>
      )}
    >
      {!open ? (
        <div style={{ fontSize: 11, color: '#888' }}>
          原始分 <b style={{ fontSize: 13, color: m.score == null ? '#bbb' : C.primary }}>{m.score == null ? '—' : Math.round(m.score)}</b>/100
          <span style={{ color: '#ddd' }}> · </span>权重 <b style={{ color: C.text }}>{fmt(m.weight, 0)}%</b>
          <span style={{ color: '#ddd' }}> · </span>贡献总分 <b style={{ color: C.text }}>{m.counted ? fmt(m.contribution, 2) : '0'}</b>
          <span style={{ color: '#bbb' }}> · {m.available ? foldedWord(m.items, isTier) : (m.note || '本次未取到该模块判定')}</span>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#888', marginBottom: 6 }}>
            <span>原始分 <b style={{ fontSize: 14, color: m.score == null ? '#bbb' : C.primary }}>{m.score == null ? '—' : Math.round(m.score)}</b>/100</span>
            <span>权重 <b style={{ color: C.text }}>{fmt(m.weight, 0)}%</b></span>
            <span>贡献总分 <b style={{ color: C.text }}>{m.counted ? fmt(m.contribution, 2) : '0'}</b></span>
            {m.state && <span style={{ color: '#aaa' }}>命中档 {m.state}</span>}
          </div>
          {!m.available && (
            <div style={{ fontSize: 11, color: m.legacy ? '#8a6d3b' : C.accent, padding: '6px 0', background: m.legacy ? '#f9f5e8' : 'transparent', borderRadius: 6 }}>
              {m.legacy && <b style={{ marginRight: 6 }}>旧存档</b>}{m.note}
            </div>
          )}
          {m.available && (m.items.length
            ? (isTier ? <TierList items={m.items} note={m.note} /> : <ItemList items={m.items} />)
            : <div style={{ fontSize: 12, color: '#bbb' }}>{m.note || '本模块无子项明细'}</div>)}
          {m.facts && <FactsLine facts={m.facts} />}
        </>
      )}
    </Card>
  )
}

/**
 * 趋势买入分（M）大卡：与「衰竭止盈分（W）」「超跌反转分（B）」同级，点标题行整体折叠（默认收起）；
 * 收起时只给一行各模块原始分摘要，展开后每张 M 卡仍各自可单独折叠
 */
function ModulesCard({ modules, buyTotal, countedCount, missingCount, usedWeight }) {
  const [open, setOpen] = useState(false)   // 大卡默认收起，与 W / B 卡一致
  if (!modules.length) return null
  return (
    <Card
      style={{ marginBottom: 8, borderTop: `3px solid ${C.primary}` }}
      onHeaderClick={() => setOpen(v => !v)}
      headerStyle={{ cursor: 'pointer' }}
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.primary, width: 11, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>趋势指标模块组（M1～M8）</span>
          <span style={{ fontSize: 11, color: '#888' }}>{modules.length} 个模块·贡献买入分 <b style={{ fontSize: 13, color: C.primary }}>{fmt(buyTotal, 1)}</b></span>
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#bbb' }}>
            {usedWeight == null ? '旧口径未记权重' : `计入权重 ${fmt(usedWeight, 0)}%`}
            {missingCount > 0 && <span style={{ color: C.accent }}> · {missingCount} 个未取到</span>}
          </span>
        </div>
      )}
    >
      {!open ? (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', fontSize: 10 }}>
          {modules.map(m => (
            <span key={m.code} title={`${m.name}：原始分 ${m.score == null ? '未取到' : Math.round(m.score)}${m.counted ? '' : '·仅提示不计入总分'}`}
              style={{ border: `1px solid ${C.tag}`, borderRadius: 8, padding: '1px 6px', background: '#fff', color: m.available ? (m.counted ? C.text : '#999') : '#bbb' }}>
              {String(m.code).toUpperCase()} <b style={{ color: m.score == null ? '#bbb' : C.primary }}>{m.score == null ? '—' : Math.round(m.score)}</b>
            </span>
          ))}
          <span style={{ color: '#bbb', marginLeft: 4 }}>逐模块明细已收起，点标题行展开{countedCount ? `（${countedCount} 个参与总分）` : ''}</span>
        </div>
      ) : (
        <div style={{ background: '#fbf8f8', borderRadius: 8, padding: '2px 8px 2px' }}>
          {/* key 带上参与标记：重算后某模块从「未取到」变成「计入总分」时重新挂载，才会按新的默认态展开 */}
          {modules.map(m => <ModuleCard key={`${m.code}-${m.counted && m.available ? 'open' : 'shut'}`} m={m} />)}
        </div>
      )}
    </Card>
  )
}

/** 现算结果（scoreRow）→ 页面 detail：与评估读档保持同一字段形状，模块卡不区分来源 */
function pickDetail(d) {
  return {
    weighted_total: d.weighted_total, band: d.band,
    dow_score: d.dow_score, granville_score: d.granville_score,
    criterion_scores: d.criterion_scores || {}, details: d.details || [],
    trend_label: d.trend_label || '', pool_type: d.pool_type || '',
    ma_state_label: d.ma_state_label || '', data_quality: d.data_quality || '',
    used_weight: d.used_weight ?? null, weight_sum: d.weight_sum ?? null,
    modules_missing: d.modules_missing || 0,
    exhaustion: d.exhaustion || null,
    // 反转（B）与两套综合分：现算行带完整 reversal（含 groups/chip）
    reversal: d.reversal || null,
    composite: d.composite || null, S_A: d.S_A ?? null, S_B: d.S_B ?? null,
    run_stage: d.run_stage || '', pre_filter_history: [],
  }
}

/**
 * 五张分数卡：三个基础分（A/B/W）+ 两套综合分（S_A/S_B）
 *  value=null 统一显「—」（未判定：W 无数据 / B 组整组关闭），不混用 0 分
 */
function ScoreCards({ items }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
      {items.map(it => (
        <div key={it.key} title={it.title || ''}
          style={{ flex: '1 1 58px', minWidth: 60, background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 8, padding: '6px 6px', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: '#999', whiteSpace: 'nowrap' }}>{it.label}</div>
          <div style={{ fontSize: 17, fontWeight: 900, lineHeight: 1.25, color: it.value == null ? '#ccc' : (it.color || C.primary) }}>
            {it.value == null ? '—' : fmt(it.value, it.digits ?? 1)}
          </div>
          <div style={{ fontSize: 9, color: '#bbb', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.sub || ''}</div>
        </div>
      ))}
    </div>
  )
}

/** 粗筛 vs 精选对比：同一天两轮口径的 B 分与每组得分差异（精选覆盖落库时保留了旧粗筛快照）*/
function StageCompare({ current, history }) {
  const old = (history || [])[history.length - 1]
  const [open, setOpen] = useState(false)
  if (!old) return null
  const oRev = old.reversal_summary || null
  const curGroups = current.groups || []
  const oldGroups = oRev?.groups || []
  return (
    <div style={{ marginTop: 8, borderTop: '1px dashed #e5d0d2', paddingTop: 6 }}>
      <div onClick={() => setOpen(v => !v)} style={{ fontSize: 11, color: C.primary, cursor: 'pointer', fontWeight: 700 }}>
        {open ? '▾' : '▸'} 粗筛 vs 精选对比（粗筛时间 {old.saved_at ? String(old.saved_at).slice(0, 16).replace('T', ' ') : '—'}）
      </div>
      {open && (
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
            <span>反转分：粗筛 <b>{oRev ? fmt(oRev.total, 0) : '—'}</b> → 精选 <b style={{ color: C.primary }}>{fmt(current.total, 0)}</b></span>
            <span>筹码：{oRev?.chip?.source || 'none'} → {current.chip?.source || 'none'}</span>
          </div>
          {oldGroups.map(g => {
            const now = curGroups.find(x => x.code === g.code)
            const diff = now ? Number(now.earned) - Number(g.earned) : null
            return (
              <div key={g.code} style={{ display: 'flex', gap: 6, padding: '2px 0', borderBottom: '1px solid #f7f2f2' }}>
                <span style={{ width: 96 }}>{g.code.toUpperCase()} {now?.name ? `· ${now.name}` : ''}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>粗筛 {fmt(g.earned, 0)} / 精选 {now ? fmt(now.earned, 0) : '—'}</span>
                <span style={{ width: 52, textAlign: 'right', color: diff > 0 ? '#2e7d32' : diff < 0 ? '#b3261e' : '#bbb' }}>
                  {diff == null ? '—' : `${diff > 0 ? '+' : ''}${fmt(diff, 0)}`}
                </span>
              </div>
            )
          })}
          {!oldGroups.length && <div style={{ color: '#bbb' }}>旧粗筛快照未含分组明细（旧口径记录）</div>}
        </div>
      )}
    </div>
  )
}

/**
 * 超跌反转分（B）卡：总分+等级、整组前置（超跌回撤）与命中的反转结构；
 * B1～B7 逐子项展示【理论来源 / 是否命中 / 得分 / 判定依据 / 指标数值】，B7 附筹码原始摘要与来源标注
 */
function ReversalCard({ rev, groups, runStage, history, poolLabel }) {
  const band = rev?.band || null
  const chip = rev?.chip || null
  const list = groups || []
  const [open, setOpen] = useState(false)   // 默认折叠：标题带上总分，收起也能读分
  return (
    <Card
      style={{ marginBottom: 8, borderTop: `3px solid ${band?.color || '#ccc'}` }}
      onHeaderClick={() => setOpen(v => !v)}
      headerStyle={{ cursor: 'pointer' }}
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.primary, width: 11, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>反转打分模块</span>
          {band
            ? <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: band.color || '#999', borderRadius: 10, padding: '2px 10px' }}>{band.icon || ''} {band.label} {fmt(rev.total, 0)}</span>
            : <span style={{ fontSize: 11, color: '#bbb' }}>未判定</span>}
          {runStage && (
            <span style={{ marginLeft: 'auto', fontSize: 10, color: C.primary, border: `1px solid ${C.tag}`, borderRadius: 8, padding: '1px 6px' }} title="本轮打分口径">{STAGE_LABEL[runStage] || runStage}</span>
          )}
        </div>
      )}
    >
      {rev == null ? (
        <div style={{ fontSize: 12, color: '#bbb' }}>这条存档未含反转判定（反转打分模块上线前或整组关闭时的记录），在「权重配置」打开后重算即可生成</div>
      ) : !open ? (
        <div style={{ fontSize: 11, color: '#bbb' }}>底部反转结构（B1～B7）已收起，点标题行展开</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#888', marginBottom: 6 }}>
            <span>反转分 <b style={{ fontSize: 15, color: band?.color || '#bbb' }}>{rev.total == null ? '—' : fmt(rev.total, 0)}</b>/100</span>
            <span>模式 <b style={{ color: C.text }}>B1～B7 累加封顶 100</b></span>
            {rev.total != null && <span>命中 <b style={{ color: C.text }}>{rev.hitCount || 0}</b> 项，原始 {rev.raw}/{rev.maxPoints} 分</span>}
            {rev.drawdown_pct != null && <span>60 日回撤 <b style={{ color: rev.oversold ? C.primary : '#bbb' }}>{fmt(rev.drawdown_pct, 1)}%</b></span>}
            {rev.dist_to_low_pct != null && <span>距 60 日低 <b style={{ color: C.text }}>{fmt(rev.dist_to_low_pct, 1)}%</b></span>}
          </div>
          {band?.advice && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>建议：{band.advice}</div>}
          {rev.oversold === false && (
            <div style={{ fontSize: 11, color: '#8a6d3b', background: '#f9f5e8', borderRadius: 6, padding: '4px 8px', marginBottom: 4 }}>
              {rev.gate_note || '未达超跌前置（60 日回撤不够），底部结构前提不成立，B1～B7 全不计分——避开假底部反弹。'}
              {poolLabel && /超跌反弹/.test(poolLabel) && (
                <div style={{ marginTop: 3 }}>
                  注：顶部的「{poolLabel}」来自每日追资金那套道氏趋势 + 超跌止跌放量判定（看的是距 60 日低的位置），与本卡的反转分（要求 60 日回撤达标）不是同一口径，所以会出现「归为超跌反弹票但反转分为 0」。
                </div>
              )}
            </div>
          )}
          {rev.degraded && <div style={{ fontSize: 11, color: '#c0392b', marginBottom: 4 }}>⚠ 日线序列不足，本卡多为【数据降级近似判定】</div>}
          {rev.note && <div style={{ fontSize: 11, color: C.accent, marginBottom: 4 }}>{rev.note}</div>}
          {list.map(g => (
            <div key={g.code} style={{ borderTop: '1px solid #f2f2f2', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <b style={{ color: g.enabled && g.applicable ? C.text : '#aaa' }}>{g.name}</b>
                <span style={{ color: '#bbb', fontSize: 10 }}>{g.code}{g.exclusive ? ' · 组内互斥' : ''}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 12, color: g.earned > 0 ? C.primary : '#bbb' }}>
                  {fmt(g.earned, 0)}/{fmt(g.groupMax, 0)} 分
                </span>
              </div>
              {!g.enabled && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>开关已关闭，不计分</div>}
              {g.enabled && !g.applicable && (
                <div style={{ fontSize: 11, color: '#8a6d3b', background: '#f9f5e8', borderRadius: 6, padding: '3px 8px', marginTop: 2 }}>{g.note || '前置条件不成立或数据不足，本组不计分'}</div>
              )}
              {g.enabled && (g.items || []).map(it => {
                const blocked = !it.met && (it.blocked || it.hit)   // 结构成立但被整组前置 / 开关拦住，不计分
                return (
                <div key={it.id} style={{ display: 'flex', gap: 8, padding: '5px 0', alignItems: 'flex-start', opacity: it.met ? 1 : (blocked ? 0.9 : 0.6) }}>
                  <span style={{ width: 16, fontSize: 13, fontWeight: 900, color: it.met ? C.primary : (blocked ? C.accent : '#c3c3c3') }}>{it.met ? '✓' : (blocked ? '⊘' : '✗')}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: it.met ? 700 : 500, color: it.met ? C.text : '#999' }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: '#bbb' }}>{it.id}</span>
                      {it.label}
                      <DegradedTag on={it.degraded} />
                      <span style={{ float: 'right', fontSize: 11, color: it.met ? C.primary : (blocked ? C.accent : '#bbb') }}>
                        {it.met ? (it.tiers ? `${it.earned}（档 ${it.level}）` : `+${it.earned}`) : (blocked ? '不计分' : `+0/${it.points}`)}
                      </span>
                    </div>
                    {it.theory && <div style={{ fontSize: 10, color: C.accent, marginTop: 1 }}>理论来源：{it.theory}</div>}
                    {it.detail && <div style={{ fontSize: 10, color: '#aaa', marginTop: 1, lineHeight: 1.4 }}>{it.detail}</div>}
                    {it.facts && <FactsLine facts={it.facts} />}
                  </div>
                </div>
                )
              })}
            </div>
          ))}
          {/* B7 筹码原始摘要：只用真实接口，拉不到就是 0 分 + 来源标注，不做日线近似 */}
          {chip && (
            <div style={{ marginTop: 8, padding: 8, background: chip.source === 'real_api' ? '#faf6f6' : '#fafafa', borderRadius: 8, fontSize: 11, color: '#888' }}>
              <div style={{ fontWeight: 700, color: chip.source === 'real_api' ? C.primary : '#999', marginBottom: 2 }}>
                💰 B7 筹码数据源：{chip.source === 'real_api' ? '真实筹码接口（ak.stock_cyq_em）' : chip.source === 'failed' ? '接口获取失败 → 本项 0 分' : '本轮未请求筹码接口'}
              </div>
              <div style={{ lineHeight: 1.6 }}>{chip.detail || '—'}</div>
              {chip.facts && <FactsLine facts={chip.facts} />}
            </div>
          )}
          <HistoryAndCompare rev={rev} list={list} history={history} />
        </>
      )}
    </Card>
  )
}

// 只有拿到旧粗筛快照时才多一行入口（不干扰常规阅读）
function HistoryAndCompare({ rev, list, history }) {
  if (!history?.length) return null
  return <StageCompare current={{ total: rev.total, groups: list, chip: rev.chip }} history={history} />
}

/**
 * 衰竭止盈分（W）卡：总分+等级、归一模式与满分基数、W1-W8 分组明细（命中子项/得分/detail/facts）；
 * 不生效组（无清晰波段结构/非高位）与未判定组单独标注，不计分也不进模式 A 分母
 */
function SellExhaustCard({ sell, groups }) {
  const band = sell?.band || null
  const [open, setOpen] = useState(false)   // 默认折叠：标题带上衰竭总分，收起也能读分
  return (
    <Card
      style={{ marginBottom: 8, borderTop: `3px solid ${band?.color || '#999'}` }}
      onHeaderClick={() => setOpen(v => !v)}
      headerStyle={{ cursor: 'pointer' }}
      title={(
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: C.primary, width: 11, flexShrink: 0 }}>{open ? '▾' : '▸'}</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: C.text }}>衰竭风险评估</span>
          {band
            ? <span style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: band.color || '#999', borderRadius: 10, padding: '2px 10px' }}>{band.icon || ''} {band.label} {fmt(sell.total, 0)}</span>
            : <span style={{ fontSize: 11, color: '#bbb' }}>未判定</span>}
        </div>
      )}
    >
      {sell == null ? (
        <div style={{ fontSize: 12, color: '#bbb' }}>这条存档未含衰竭判定（旧口径记录），点上方「重新计算」后生成</div>
      ) : !open ? (
        <div style={{ fontSize: 11, color: '#bbb' }}>兑现风险子项（W1～W8）已收起，点标题行展开</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: '#888', marginBottom: 6 }}>
            <span>衰竭分 <b style={{ fontSize: 15, color: band?.color || '#bbb' }}>{sell.total == null ? '—' : fmt(sell.total, 0)}</b>/100</span>
            <span>模式 <b style={{ color: C.text }}>{sell.mode === 'B' ? '子项直接累加封顶 100' : '启用子项满分归一'}</b></span>
            {sell.total != null && <span>命中 <b style={{ color: C.text }}>{sell.hitCount || 0}</b> 项，原始 {sell.raw}/{sell.maxPoints} 分</span>}
          </div>
          {band?.advice && <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>建议：{band.advice}</div>}
          {sell.note && <div style={{ fontSize: 11, color: C.accent, marginBottom: 4 }}>{sell.note}</div>}
          {(groups || []).map(g => (
            <div key={g.code} style={{ borderTop: '1px solid #f2f2f2', padding: '8px 0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                <b style={{ color: g.enabled && g.applicable && g.available ? C.text : '#aaa' }}>{g.name}</b>
                <span style={{ color: '#bbb', fontSize: 10 }}>{g.code}</span>
                <span style={{ marginLeft: 'auto', fontWeight: 700, fontSize: 12, color: g.earned > 0 ? '#b3261e' : '#bbb' }}>
                  {fmt(g.earned, 0)}/{fmt(g.groupMax, 0)} 分
                </span>
              </div>
              {!g.enabled && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>开关已关闭，不计分不进分母</div>}
              {g.enabled && !g.available && <div style={{ fontSize: 11, color: '#bbb', marginTop: 2 }}>{g.note || '本次未取到该组判定（数据不足）'}</div>}
              {g.enabled && g.available && !g.applicable && (
                <div style={{ fontSize: 11, color: '#8a6d3b', background: '#f9f5e8', borderRadius: 6, padding: '3px 8px', marginTop: 2 }}>{g.note || '结构不适用，本组不生效不计分'}</div>
              )}
              {g.enabled && g.available && g.applicable && (g.items || []).map(it => (
                <div key={it.id} style={{ display: 'flex', gap: 8, padding: '5px 0', alignItems: 'flex-start', opacity: it.met ? 1 : 0.55 }}>
                  <span style={{ width: 16, fontSize: 13, fontWeight: 900, color: it.met ? '#b3261e' : '#c3c3c3' }}>{it.met ? '⚠' : '✗'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: it.met ? 700 : 500, color: it.met ? C.text : '#999' }}>
                      <span style={{ marginRight: 6, fontSize: 10, color: '#bbb' }}>{it.id}</span>
                      {it.label}
                      <span style={{ float: 'right', fontSize: 11, color: it.met ? '#b3261e' : '#bbb' }}>
                        {it.met ? (it.tiers ? `${it.earned}（档 ${it.level}）` : `+${it.earned}`) : `+0/${it.points}`}
                      </span>
                    </div>
                    {it.detail && <div style={{ fontSize: 10, color: '#aaa', marginTop: 1, lineHeight: 1.4 }}>{it.detail}</div>}
                  </div>
                </div>
              ))}
              {g.enabled && g.available && g.facts && <FactsLine facts={g.facts} />}
            </div>
          ))}
        </>
      )}
    </Card>
  )
}

/**
 * 五分数体系阅读指南：三个基础分 + 两套综合分的公式与实际值。
 * 从衰竭风险评估卡里挪出来，放在全部模块卡之后、K 线复盘之前，常显不折叠
 */
function ScoreGuideCard({ sell, band, composite, buyTotal, revTotal }) {
  const cmp = composite || null
  const wA = (cmp && cmp.wA) ?? 0.8
  const wB = (cmp && cmp.wB) ?? 0.2
  return (
    <Card title="📖 五分数体系怎么读" style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: '#888', lineHeight: 1.7 }}>
        <div>买入分（趋势） <b>{fmt(buyTotal, 1)}</b> —— 趋势好不好（趋势指标模块加权）</div>
        <div>反转分 <b>{revTotal == null ? '未判定（反转打分模块关闭）' : fmt(revTotal, 0)}</b> —— 超跌有没有底部反转结构（B1～B7 子项累加）</div>
        <div>衰竭分 <b style={{ color: band?.color || '#999' }}>{sell?.total == null ? '未判定' : fmt(sell.total, 0)}</b> —— 兑现风险高不高（W1～W8 子项累加）</div>
        <div style={{ marginTop: 2 }}>
          趋势综合分 <b style={{ color: cmp?.S_A ? C.primary : '#bbb' }}>{cmp?.S_A ? fmt(cmp.S_A.score, 1) : '未判定'}</b>
          ＝ 买入分（趋势）×{wA} − 衰竭分×{wB}（趋势赛道排序）；
          反转综合分 <b style={{ color: cmp?.S_B ? C.primary : '#bbb' }}>{cmp?.S_B ? fmt(cmp.S_B.score, 1) : '未判定'}</b>
          ＝ 反转分×{wA} − 衰竭分×{wB}（反转赛道排序）
        </div>
        <div style={{ fontSize: 10, color: '#aaa' }}>钳位后平移使输出恒为 0～100；衰竭分未判定或反转打分模块关闭时，对应综合分记「未判定」而不是 0 分。</div>
        <div style={{ color: '#b3261e', marginTop: 4 }}>衰竭分是概率性风险提示，非强制卖出信号；高位≠马上跌，趋势票可边持边警戒。</div>
      </div>
    </Card>
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
  const [sector, setSector] = useState('')

  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState(null)   // { criterion_scores, details, weighted_total, band, trend_label, ... }
  const [doc, setDoc] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { fortuneApi.getCriteria().then(r => { if (r.ok) setDoc(r.data) }) }, [])

  // 从评估记录还原明细行（criterion_scores 里存了每个模块的 items/state/facts/贡献，0 行情请求就能重现）
  const fromEvaluation = useCallback((ev) => {
    const cs = ev.criterion_scores || {}
    const b = (doc?.bands || []).find(x => x.code === (ev.band_code || ev.band?.code))
    return {
      weighted_total: Number(ev.weighted_total),
      sector: ev.sector || '',
      band: ev.band || (b ? { code: b.code, label: b.band_label || ev.band_label || b.label, color: b.color } : { label: ev.band_label || '', color: '#999' }),
      dow_score: cs.dow?.score ?? null,
      granville_score: cs.granville?.score ?? null,
      criterion_scores: cs,
      details: (ev.criteria_snapshot?.weights || []).map(w => ({ code: w.code, name: w.name, weight: Number(w.weight) })),
      trend_label: ev.trend_label || '', pool_type: ev.pool_type || '',
      ma_state_label: ev.ma_state_label || cs.ma?.state_label || '',
      data_quality: ev.data_quality || '', used_weight: ev.used_weight ?? null,
      // 衰竭（W）：汇总来自 snapshot 顶层，分组明细在 criterion_scores 里带 sell:true 的条目
      sell_summary: ev.sell_summary || (ev.exhaustion_total != null ? { total: ev.exhaustion_total, band: ev.exhaustion_band } : null),
      // 反转（B）与两套综合分：同上，分组明细在 criterion_scores 里带 reversal:true 的条目
      reversal_summary: ev.reversal_summary || (ev.reversal_total != null ? { total: ev.reversal_total, band: ev.reversal_band } : null),
      composite: ev.composite || null, S_A: ev.S_A ?? null, S_B: ev.S_B ?? null,
      run_stage: ev.run_stage || '', pre_filter_history: ev.pre_filter_history || [],
      exhaustion_total: ev.exhaustion_total ?? null,
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
        if (res.data[0].sector) setSector(res.data[0].sector)
        setDetail(fromEvaluation(res.data[0]))
        return
      }
      // 2) 没有存档 → 按需现算一次（会拉行情）
      const r = await fortuneApi.getStockScore(symbol, date)
      if (!r.ok) { setErr(r.error || '未取得打分数据'); return }
      const d = r.data
      if (d.name) setName(d.name)
      if (d.sector) setSector(d.sector)
      setDetail(pickDetail(d))
    } catch (e) {
      setErr(`加载失败：${e.message}`)
    } finally { setLoading(false) }
  }, [symbol, date, fromEvaluation])

  useEffect(() => { if (doc) load() }, [doc, load])

  // 单票「重新计算」：强制按当前/该时间点重跑；withChip=true 时额外请求真实筹码接口补 B7（历史时间点后端会忽略）
  const recompute = async (withChip) => {
    setLoading(true); setErr('')
    try {
      const r = await fortuneApi.getStockScore(symbol, date, !!withChip)
      if (!r.ok) { setErr(r.error || '计算失败'); setLoading(false); return }
      const d = r.data
      if (d.name) setName(d.name)
      if (d.sector) setSector(d.sector)
      setDetail(pickDetail(d))
      Toast.show({ content: withChip ? '已重算（含真实筹码）' : '已重新计算' })
    } catch (e) { Toast.show({ content: `计算失败：${e.message}` }) } finally { setLoading(false) }
  }

  const cs = detail?.criterion_scores || {}
  const band = detail?.band || {}
  // 衰竭（W）展示数据：现算行带完整 exhaustion.groups；读档行用 sell_summary + cs 里 sell:true 的组还原
  const exh = detail ? (detail.exhaustion || detail.sell_summary || null) : null
  const exhGroups = useMemo(() => {
    if (detail?.exhaustion?.groups?.length) return detail.exhaustion.groups
    const built = Object.entries(cs)
      .filter(([, v]) => v && v.sell)
      .map(([code, v]) => ({
        code, name: v.name || String(code).toUpperCase(), enabled: !!v.enabled, available: !!v.available, applicable: !!v.applicable,
        earned: Number(v.score) || 0, groupMax: Number(v.groupMax) || 0, items: Array.isArray(v.items) ? v.items : [], facts: v.facts || null, note: v.note || '',
      }))
    return built.length ? built : null
  }, [cs, detail])
  // 反转（B）：同样两路同构（现算行带 reversal.groups，读档行用 reversal_summary + cs 里 reversal:true）
  const rev = detail ? (detail.reversal || detail.reversal_summary || null) : null
  const revGroups = useMemo(() => {
    if (detail?.reversal?.groups?.length) return detail.reversal.groups
    const built = Object.entries(cs)
      .filter(([, v]) => v && v.reversal)
      .map(([code, v]) => ({
        code, name: v.name || String(code).toUpperCase(), enabled: !!v.enabled, applicable: !!v.applicable, exclusive: !!v.exclusive,
        earned: Number(v.score) || 0, groupMax: Number(v.groupMax) || 0, items: Array.isArray(v.items) ? v.items : [], facts: v.facts || null, note: v.note || '',
      }))
    return built.length ? built : null
  }, [cs, detail])
  // 模块卡片清单完全跟配置走：新增/禁用/改权重都不需改本页
  const modules = useMemo(() => buildModules(cs, doc?.criteria, detail?.details), [cs, doc, detail])
  const countedCount = modules.filter(m => m.counted).length
  const missingCount = modules.filter(m => !m.available).length
  const degraded = detail?.data_quality === 'approximated' || Object.values(cs).some(x => x?.items?.some(i => i.degraded))
  const trendLabel = detail?.pool_type === 'B' ? '超跌反弹票' : (detail?.pool_type === 'A' ? '趋势票' : (detail?.trend_label || ''))
  // 五张分数卡的数据源：现算行与读档行都归一到同一形状
  const A = detail ? Number(detail.weighted_total) : null
  const B = detail ? (rev && rev.total != null ? Number(rev.total) : null) : null
  const W = exh && exh.total != null ? Number(exh.total) : null
  const cmp = detail?.composite || null
  const SA = cmp && cmp.S_A ? Number(cmp.S_A.score) : null
  const SB = cmp && cmp.S_B ? Number(cmp.S_B.score) : null
  const isPast = !!date && date !== new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
  const scoreCards = detail && [
    { key: 'A', label: '买入分', value: A, color: C.primary, sub: band.label || '', title: '买入分（趋势）：M1~M8 模块加权' },
    { key: 'B', label: '反转分', value: B, color: rev?.band?.color || C.accent, sub: rev?.band?.label || (B == null ? '模块未开启' : ''), title: '反转分：B1~B7 子项累加封顶 100' },
    { key: 'W', label: '衰竭分', value: W, color: exh?.band?.color || '#b3261e', sub: exh?.band?.label || (W == null ? '未判定' : ''), title: '衰竭分：越高越需警惕兑现风险' },
    { key: 'SA', label: '趋势综合', value: SA, color: C.primary, sub: `买入×${(cmp && cmp.wA) ?? 0.8}−衰竭×${(cmp && cmp.wB) ?? 0.2}`, title: '趋势综合分：趋势赛道排序用（钳位后平移，恒定 0～100）' },
    { key: 'SB', label: '反转综合', value: SB, color: C.accent, sub: `反转×${(cmp && cmp.wA) ?? 0.8}−衰竭×${(cmp && cmp.wB) ?? 0.2}`, title: '反转综合分：反转赛道排序用（钳位后平移，恒定 0～100）' },
  ]

  return (
    <div className="page-container" style={{ paddingBottom: 24 }}>
      <NavBar back={<LeftOutline />} onBack={() => navigate('/fortune')} style={{ '--border-bottom': 'none', fontWeight: 800, color: C.primary }}>
        {name || symbol}{sector && <span style={{ fontSize: 11, fontWeight: 600, color: C.accent, marginLeft: 6 }}>[{sector}]</span>} · 招财进宝打分
      </NavBar>

      {/* 总分 + 分档 */}
      <Card style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#999' }}>{date ? `时间点 ${date}` : '当前最新'}</div>
        {loading && !detail && <div style={{ padding: 20, textAlign: 'center' }}><DotLoading color={C.primary} /></div>}
        {err && <div style={{ padding: 12, fontSize: 12, color: C.accent }}>{err}　<Button size="mini" fill="outline" onClick={() => recompute(false)}>重试</Button></div>}
        {detail && (
          <div style={{ background: C.light, borderRadius: 10, padding: 12, borderLeft: `4px solid ${band.color || C.primary}`, marginTop: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: C.primary, lineHeight: 1 }}>{fmt(detail.weighted_total, 1)}</span>
              <span style={{ fontSize: 16, fontWeight: 800, color: band.color || C.primary }}>{band.label || '—'}</span>
              <div style={{ flex: 1 }} />
              <Button size="mini" fill="outline" style={{ '--border-color': C.accent, '--text-color': C.accent }} loading={loading} onClick={() => recompute(false)}>重新计算</Button>
            </div>
            {/* A/B/W/S_A/S_B 五张分数卡 */}
            {scoreCards && <ScoreCards items={scoreCards} />}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 8, flexWrap: 'wrap' }}>
              <Button size="mini" fill="outline" loading={loading} disabled={isPast || loading}
                title={isPast ? '历史时间点只有最新筹码数据，口径不匹配，不请求接口' : '走 --with-chip 拉东方财富真实筹码（cyq）补筹码分项'}
                style={{ '--border-color': C.primary, '--text-color': C.primary }}
                onClick={() => recompute(true)}>重算（含真实筹码）</Button>
              {detail.run_stage && (
                <span style={{ fontSize: 10, color: C.primary, background: C.tag, borderRadius: 8, padding: '1px 6px' }} title="本轮打分口径">{STAGE_LABEL[detail.run_stage] || detail.run_stage}</span>
              )}
              {rev?.chip && (
                <span style={{ fontSize: 10, color: rev.chip.source === 'real_api' ? C.primary : '#999' }} title={rev.chip.detail}>
                  💰 {rev.chip.source === 'real_api' ? '真实筹码接口' : rev.chip.source === 'failed' ? '接口失败·B7=0' : '未请求筹码'}
                </span>
              )}
              {isPast && <span style={{ fontSize: 10, color: '#bbb' }}>历史定格口径：收盘截断、不请求实时筹码</span>}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              {sector && (
                <span style={{ fontSize: 11, fontWeight: 700, color: C.primary, background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: '2px 8px' }}>板块 {sector}</span>
              )}
              {trendLabel && (
                <span
                  style={{ fontSize: 11, fontWeight: 700, color: '#fff', background: detail.pool_type === 'B' ? '#C4737A' : C.primary, borderRadius: 10, padding: '2px 8px' }}
                  title="来自每日追资金流水线的道氏分段归类（趋势/超跌反弹），只作展示；与招财进宝的反转分（B1～B7 + 60 日回撤≥15% 前置）是两套独立口径"
                >{trendLabel}</span>
              )}
              {detail.ma_state_label && (
                <span style={{ fontSize: 11, color: C.primary, background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: '2px 8px' }}>均线 {detail.ma_state_label}</span>
              )}
              <span style={{ fontSize: 11, color: '#999' }}>
                {detail.used_weight == null
                  ? <span style={{ color: '#8a6d3b' }}>该存档未记录参与权重（多模块上线前的旧口径）</span>
                  : <>{countedCount} 个模块参与总分归一化<span style={{ color: '#bbb' }}>（计入权重 {fmt(detail.used_weight, 0)}%）</span></>}
                {missingCount > 0 && <span style={{ color: C.accent }}> · {missingCount} 个未取到已剔除</span>}
              </span>
            </div>
            {degraded && <div style={{ fontSize: 10, color: '#c0392b', marginTop: 4 }}>⚠ 部分条目为【数据降级近似判定】（未拿到足够连续日线）</div>}
            {band.advice && <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{band.advice}</div>}
          </div>
        )}
      </Card>

      {/* 衰竭风险评估：卖出警示独立打分，与买入分分开读 */}
      {detail && <SellExhaustCard sell={exh} groups={exhGroups} />}

      {/* 反转打分模块：紧跟衰竭风险评估之后，筹码分项只用真实筹码接口 */}
      {detail && <ReversalCard rev={rev} groups={revGroups} runStage={detail.run_stage} history={detail.pre_filter_history} poolLabel={trendLabel} />}

      {/* 趋势买入模块大卡：整卡可折叠，内部每张 M 卡再各自折叠；K 线复盘卡不折叠 */}
      {detail && <ModulesCard modules={modules} buyTotal={A} countedCount={countedCount} missingCount={missingCount} usedWeight={detail.used_weight} />}
      {!modules.length && !loading && (
        <Card style={{ marginBottom: 8 }}><div style={{ fontSize: 12, color: '#bbb' }}>暂无模块明细（未打分或判定项全部关闭）</div></Card>
      )}

      {/* 五分数体系阅读指南：放在所有模块卡之后、K 线复盘之前，常显展示 */}
      {detail && <ScoreGuideCard sell={exh} band={exh?.band || null} composite={cmp} buyTotal={A} revTotal={B} />}

      {/* K 线复盘 */}
      <ReviewChart symbol={symbol} name={name} asOfDate={date} />
    </div>
  )
}
