/**
 * 胡胖胖招财进宝 —— 判定项配置
 *
 * 改每项权重、开关、子项分值；新增自定义判定项；恢复出厂重播种。
 * 买入区保存走 PUT /fortune/criteria；衰竭止盈（W）与超跌反转（B）各分两块：
 *   — W1~W8 / B1~B7 组开关与子项分值（含分档）→ 同 PUT /fortune/criteria（type=sell_auto / reversal_auto 行）
 *   — 归一模式 / 等级区间 / 综合分与筹码限流 / wp_*、bp_* 阈值 → PUT /fortune/sell-config（覆盖值存 SystemConfig）
 * 成功后回传最新 doc 让主页面刷新。
 */
import React, { useEffect, useState } from 'react'
import { Button, Input, Popup, Switch, Toast } from 'antd-mobile'
import { fortuneApi } from '../../services/api'
import { C, fmt } from './helpers'

function PopupHeader({ title, onClose }) {
  return (
    <div style={{ position: 'sticky', top: 0, zIndex: 2, background: '#fff', display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${C.tag}` }}>
      <span style={{ fontSize: 15, fontWeight: 700, color: C.primary, flex: 1 }}>{title}</span>
      <span onClick={onClose} style={{ fontSize: 22, color: '#999', padding: '0 6px', cursor: 'pointer' }}>×</span>
    </div>
  )
}

// 模块阈值中文说明（真值在配置文件 module_params，页面只读展示）
const PARAM_LABEL = {
  fp_compute: '多模块判定下发开关',
  fp_window_break: '量价：突破窗口（根）',
  fp_vol_break_ratio: '量价：突破放量倍数',
  fp_vol_shrink_ratio: '量价：回调缩量倍数',
  fp_pullback_days: '量价：连续回落根数',
  fp_stall_vol_ratio: '量价：放量滞涨倍数',
  fp_stall_max_pct: '量价：滞涨涨幅上限%',
  fp_ma_short: '均线：短周期',
  fp_ma_long: '均线：长周期',
  fp_ma_slope_bars: '均线：方向判定根数（1=对比前一根）',
  fp_dmi_period: 'DMI：周期',
  fp_adx_strong: 'DMI：强趋势 ADX 线',
  fp_adx_trend: 'DMI：趋势成型 ADX 线',
  fp_adx_weak: 'DMI：震荡 ADX 线',
  fp_fib_lookback: '斐波那契：波段回看根数',
  fp_fib_ratios: '斐波那契：回撤档位',
  fp_fib_tolerance: '斐波那契：贴近容差%',
  fp_box_window: '箱体：窗口根数',
  fp_box_min_amp_pct: '箱体：最小振幅%',
  fp_box_retest_tolerance_pct: '箱体：回踩容差%',
  fp_candle_shadow_body_ratio: '蜡烛：影线/实体倍数',
  fp_candle_upper_body_ratio: '蜡烛：上影/实体上限',
  fp_candle_body_pos_min: '蜡烛：实体位置下限',
  fp_candle_trend_lookback: '蜡烛：前置趋势根数',
}
const paramText = v => (Array.isArray(v) ? v.join(' / ') : typeof v === 'boolean' ? (v ? '开' : '关') : String(v))

// 衰竭 wp_* 阈值中文说明（可编辑；缺登记的键原样显示，后端加参数不必同步改页面）
const WP_LABEL = {
  wp_ma_ref: 'W1：乖离参考均线周期',
  wp_dev_light: 'W1：轻度乖离%',
  wp_dev_mid: 'W1：明显乖离%',
  wp_dev_severe: 'W1：严重乖离%',
  wp_valid_break_pct: 'W1：有效跌破偏离%',
  wp_swing_window: 'W2：波段极值窗口（±根）',
  wp_struct_lookback: 'W2：结构回看根数',
  wp_hh_shrink_ratio: 'W2：新高抬升收窄倍数',
  wp_hh_shrink_min_pct: 'W2：抬升幅度下限%',
  wp_vol_div_ratio: 'W3：新高量能/前高量能上限',
  wp_high_zone_pct: '高位区：距阶段高 ≤%（W3/W5 前置）',
  wp_stall_vol_mult: 'W3：滞涨放量倍数',
  wp_stall_pct_max: 'W3：滞涨涨幅上限%',
  wp_turnover_min: 'W3：高换手门槛%',
  wp_shadow_body_mult: 'W3：上影/实体倍数',
  wp_shadow_drop_pct: 'W3：冲高回落幅度%',
  wp_shadow_vol_mult: 'W3：长上影放量倍数',
  wp_fib_lookback: 'W4：扩展波段回看根数',
  wp_fib_ext_ratios: 'W4：扩展位比例',
  wp_fib_ext_tolerance: 'W4：贴近容差%',
  wp_fib_min_amp_pct: 'W4：波段最小振幅%（不足不生效）',
  wp_fib_stall_bars: 'W4：贴位滞涨根数',
  wp_ext2_fail_min: 'W4：2.618 位失败次数下限',
  wp_box_window: 'W6：箱体窗口根数',
  wp_box_min_amp_pct: 'W6：箱体最小振幅%（不足不生效）',
  wp_box_touch_min: 'W6：上沿触碰次数下限',
  wp_fake_break_days: 'W6：假突破回看天数',
  wp_fake_back_pct: 'W6：跌回箱体偏离%',
  wp_div_lookback: 'W7：MACD 背离回看根数',
  wp_gain_period: 'W8：阶段涨幅统计根数',
  wp_gain_range1: 'W8：第一涨幅区间%（含上下限）',
  wp_gain_range2: 'W8：第二涨幅分界%',
}
// 两套综合分（S_A/S_B）共用参数中文说明（旧的高位争议压制 veto / 硬拦截 hard_mode 已随公式一并废除）
const OV_LABEL = {
  enabled: '综合分启用（趋势/反转综合分）',
  wA: '权重 wA（基础分侧）',
  wB: '权重 wB（衰竭扣分侧）',
}
// 超跌反转 bp_* 阈值中文说明（可编辑；缺登记的键原样显示）
const BP_LABEL = {
  bp_drawdown_min_pct: '整组前置：60 日回撤 ≥%（不算超跌则 B1~B7 全不计分）',
  bp_ma_bias_ref: 'B1：乖离参考均线周期',
  bp_bias_light: 'B1：轻度负乖离%（负数）',
  bp_bias_mid: 'B1：明显负乖离%（负数）',
  bp_bias_severe: 'B1：深度负乖离%（负数）',
  bp_slope_window: 'B2：斜率比较窗口（根）',
  bp_slope_shrink_ratio: 'B2：斜率放缓倍数（近段/前段 ≤）',
  bp_low_window: 'B2：阶段低点回看根数',
  bp_flat_bars: 'B2：不再创新低的连续根数',
  bp_div_lookback: 'B3：底背离回看根数',
  bp_div_swing_window: 'B3：阶段低点确认窗口（±根）',
  bp_shrink_days: 'B4：前期缩量阴跌统计根数',
  bp_shrink_vol_ratio: 'B4：缩量均量/MAV 上限',
  bp_shrink_bear_min: 'B4：其中阴跌根数下限',
  bp_vol_mild_ratio: 'B4：温和放量倍数（×MAV20）',
  bp_vol_break_ratio: 'B4：放量阳线倍数（×MAV20）',
  bp_break_lookback: 'B4：突破近 N 根高点',
  bp_low_zone_pct: 'B5：阶段低位门槛（距 60 日低 ≤%）',
  bp_candle_shadow_body_ratio: 'B5：影线/实体倍数（锤子线）',
  bp_candle_upper_body_ratio: 'B5：上影/实体上限',
  bp_candle_body_pos_min: 'B5：阳线收盘深入前实体比例下限',
  bp_candle_star_body_max: 'B5：中间星线实体/振幅上限',
  bp_morning_body_min: 'B5：启明星首阴线实体/振幅下限',
  bp_boll_period: 'B6：布林周期',
  bp_boll_k: 'B6：标准差倍数 k',
  bp_boll_tolerance_pct: 'B6：触轨容差%',
  bp_boll_touch_bars: 'B6：触轨回看根数',
  bp_chip_profit_max: 'B7：获利比例上限%（套牢盘充分）',
  bp_chip_pressure_max: 'B7：90%成本上沿距现价上限%',
}
// 筹码接口限流参数（两级打分的流量控制）
const CHIP_LABEL = {
  enable_chip: '启用精选筹码轮（关掉则 B7 永久跳过）',
  batch_max_pre_filter: '粗筛单批上限（只）',
  select_max_chip: '精选筹码单批上限（只）',
  chip_request_interval: '逐只请求间隔（毫秒）',
  chip_timeout: '单只筹码请求超时（毫秒）',
}
// 布尔型参数（渲染开关，其余渲染数字/文本输入）
const BOOL_KEYS = new Set(['enable_chip', 'enabled'])

const numCast = v => {
  if (typeof v !== 'string') return v
  const t = v.trim()
  if (t === '') return v
  const n = Number(t)
  return Number.isNaN(n) ? v : n
}
// "1.618, 2.618" 文本 ↔ 数组
const arrText = v => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))
const arrCast = (v, wasArray) => (wasArray ? String(v).split(/[,，/]/).map(x => Number(x.trim())).filter(x => !Number.isNaN(x)) : numCast(v))

export default function CriteriaConfig({ visible, onClose, doc, onSaved }) {
  const [list, setList] = useState([])
  const [saving, setSaving] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  // 衰竭（W）编辑态
  const [sellList, setSellList] = useState([])
  const [sellParams, setSellParams] = useState({})
  const [sellMode, setSellMode] = useState('A')
  const [openVal, setOpenVal] = useState({})
  const [sellBands, setSellBands] = useState([])
  // 反转（B）与筹码编辑态
  const [revList, setRevList] = useState([])
  const [revParams, setRevParams] = useState({})
  const [revBands, setRevBands] = useState([])
  const [chipCfg, setChipCfg] = useState({})

  useEffect(() => {
    if (!doc) return
    setList((doc.criteria || []).map(c => ({ ...c, items: (c.items || []).map(x => ({ ...x })) })))
    setSellList((doc.sellCriteria || []).map(c => ({ ...c, items: (c.items || []).map(x => ({ ...x, tiers: Array.isArray(x.tiers) ? [...x.tiers] : x.tiers })) })))
    setRevList((doc.reversalCriteria || []).map(c => ({ ...c, items: (c.items || []).map(x => ({ ...x, tiers: Array.isArray(x.tiers) ? [...x.tiers] : x.tiers })) })))
    setSellParams(doc.sellParams || {})
    setSellMode((doc.sellScoring || {}).mode === 'B' ? 'B' : 'A')
    const { chip: _chip, desc: _desc, ...ovRest } = doc.openValue || {}
    setOpenVal(ovRest)
    setSellBands((doc.sellBands || []).map(b => ({ ...b })))
    setRevParams(doc.reversalParams || {})
    setRevBands((doc.reversalBands || []).map(b => ({ ...b })))
    setChipCfg(doc.chip || {})
  }, [doc, visible])

  const patch = (code, kv) => setList(prev => prev.map(c => (c.code === code ? { ...c, ...kv } : c)))
  const patchItem = (code, id, kv) => setList(prev => prev.map(c => (
    c.code === code ? { ...c, items: (c.items || []).map(it => (it.id === id ? { ...it, ...kv } : it)) } : c
  )))
  const patchSell = (code, kv) => setSellList(prev => prev.map(c => (c.code === code ? { ...c, ...kv } : c)))
  const patchSellItem = (code, id, kv) => setSellList(prev => prev.map(c => (
    c.code === code ? { ...c, items: (c.items || []).map(it => (it.id === id ? { ...it, ...kv } : it)) } : c
  )))
  const patchRev = (code, kv) => setRevList(prev => prev.map(c => (c.code === code ? { ...c, ...kv } : c)))
  const patchRevItem = (code, id, kv) => setRevList(prev => prev.map(c => (
    c.code === code ? { ...c, items: (c.items || []).map(it => (it.id === id ? { ...it, ...kv } : it)) } : c
  )))

  const addCriterion = () => {
    const code = newCode.trim()
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(code)) return Toast.show({ content: '编码用小写字母开头，2-32 位（如 volume）' })
    if (list.some(c => c.code === code)) return Toast.show({ content: '该编码已存在' })
    setList(prev => [...prev, { code, name: newName.trim() || code, type: 'manual', weight: 0, enabled: true, items: [], description: '自定义判定项' }])
    setNewCode(''); setNewName('')
    Toast.show({ content: '已添加，记得设置权重并保存' })
  }

  // 保存分两路：criteria 行（买入 + W/B 开关与分值）+ sell-config（阈值/模式/区间/综合分/筹码限流）
  const save = async () => {
    const sum = list.filter(c => c.enabled).reduce((s, c) => s + Number(c.weight || 0), 0)
    if (sum <= 0) return Toast.show({ content: '启用模块权重之和为 0，总分无法归一化，请至少给一个模块权重' })
    if (Math.abs(sum - 100) > 0.01 && !window.confirm(`启用模块权重之和为 ${sum}%。总分按此归一化（不要求等于 100），确定保存？`)) return
    setSaving(true)
    try {
      const rows = [...list, ...sellList.map(c => ({ ...c, weight: 0 })), ...revList.map(c => ({ ...c, weight: 0 }))]
      const res = await fortuneApi.updateCriteria(rows.map(c => ({
        code: c.code, name: c.name, type: c.type, weight: Number(c.weight) || 0, enabled: !!c.enabled,
        items: c.items.map(it => ({ ...it, points: Number(it.points) || 0, ...(Array.isArray(it.tiers) ? { tiers: it.tiers.map(x => Number(x) || 0) } : {}) })),
      })))
      if (!res.ok) { Toast.show({ content: res.error || '判定项保存失败' }); return }
      const arrKeys = {}
      for (const [k, v] of Object.entries(doc?.sellDefaults?.sellParams || {})) arrKeys[k] = Array.isArray(v)
      const castParams = {}
      for (const [k, v] of Object.entries(sellParams)) castParams[k] = arrCast(v, arrKeys[k])
      const castRevParams = {}
      for (const [k, v] of Object.entries(revParams)) castRevParams[k] = BOOL_KEYS.has(k) ? !!v : numCast(v)
      const castOv = {}
      for (const [k, v] of Object.entries(openVal)) if (k !== 'desc') castOv[k] = BOOL_KEYS.has(k) ? !!v : numCast(v)
      const castChip = {}
      for (const [k, v] of Object.entries(chipCfg)) if (k !== 'desc') castChip[k] = BOOL_KEYS.has(k) ? !!v : numCast(v)
      const res2 = await fortuneApi.updateSellConfig({
        sellParams: castParams,
        sellScoring: { mode: sellMode },
        openValue: castOv,
        sellBands: sellBands.map(b => ({ ...b, min: Number(b.min) || 0, max: Number(b.max) || 0 })),
        reversalParams: castRevParams,
        reversalBands: revBands.map(b => ({ ...b, min: Number(b.min) || 0, max: Number(b.max) || 0 })),
        chip: castChip,
      })
      if (!res2.ok) { Toast.show({ content: res2.error || '衰竭/反转配置保存失败（判定项已保存）' }); onSaved && onSaved(res.doc); return }
      Toast.show({ content: '已保存（判定项 + 衰竭/反转/筹码配置）' })
      onSaved && onSaved(res2.doc)
    } catch (e) {
      Toast.show({ content: `保存失败：${e.message}` })
    } finally { setSaving(false) }
  }

  const reset = async () => {
    if (!window.confirm('恢复出厂会用配置文件覆盖全部判定项与衰竭/反转配置（人工新增的项会被停用但保留），确定？')) return
    const res = await fortuneApi.resetCriteria()
    if (res.ok) { Toast.show({ content: '已恢复出厂并重新播种' }); onSaved && onSaved(res.doc) }
  }

  // 只清衰竭/反转侧 SystemConfig 覆盖（判定项行/权重不动）
  const resetSell = async () => {
    if (!window.confirm('清除页面对衰竭/反转阈值、模式、综合分、筹码限流、等级区间的修改，回到配置文件默认？')) return
    const res = await fortuneApi.resetSellConfig()
    if (res.ok) { Toast.show({ content: '衰竭/反转配置已回到文件默认' }); onSaved && onSaved(res.doc) }
    else Toast.show({ content: res.error || '操作失败' })
  }

  const enabledSum = list.filter(c => c.enabled).reduce((s, c) => s + Number(c.weight || 0), 0)
  const sellMaxSum = sellList.reduce((s, c) => s + (c.items || []).reduce((a, it) => a + (Number(it.points) || 0), 0), 0)
  // B 组满分：互斥组（B5 单根/组合）取最高档，其余组内子项分值相加
  const revGroupMax = c => ((c.items || []).length && c.exclusive)
    ? Math.max(0, ...(c.items || []).map(it => Number(it.points) || 0))
    : (c.items || []).reduce((s, it) => s + (Number(it.points) || 0), 0)
  const revMaxSum = revList.reduce((s, c) => s + revGroupMax(c), 0)
  const revAnyOn = revList.some(c => c.enabled)
  const ovNum = (k, d) => { const n = Number(openVal[k]); return Number.isFinite(n) ? n : d }

  // 单个可编辑参数行（买入/衰竭共用形状）
  const paramRow = (k, v, set, defaults, isArr) => (
    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0', borderBottom: '1px dashed #f2f2f2' }}>
      <span style={{ flex: 1, color: '#666' }}>
        {(k.startsWith('wp_') ? WP_LABEL[k] : k.startsWith('bp_') ? BP_LABEL[k] : (CHIP_LABEL[k] || OV_LABEL[k])) || k}
        <span style={{ color: '#ccc', marginLeft: 4, fontSize: 10 }}>{k}</span>
      </span>
      {typeof v === 'boolean' ? (
        <Switch checked={v} onChange={x => set(prev => ({ ...prev, [k]: x }))} style={{ '--checked-color': C.primary, '--height': '20px', '--width': '40px' }} />
      ) : (
        <input type={isArr ? 'text' : 'number'} step="any" value={String(v ?? '')}
          onChange={(e) => set(prev => ({ ...prev, [k]: e.target.value }))}
          style={{ width: isArr ? 110 : 64, fontSize: 12, padding: '1px 5px', borderRadius: 6, border: `1px solid ${C.tag}`, color: C.accent, textAlign: 'center' }} />
      )}
      {defaults && defaults[k] !== undefined && paramText(defaults[k]) !== paramText(v) && (
        <span title={`恢复默认 ${paramText(defaults[k])}`} onClick={() => set(prev => ({ ...prev, [k]: defaults[k] }))}
          style={{ fontSize: 10, color: C.accent, cursor: 'pointer', width: 22 }}>↺</span>
      )}
    </div>
  )

  return (
    <Popup visible={visible} onMaskClick={onClose} bodyStyle={{ height: '86vh', borderTopLeftRadius: 14, borderTopRightRadius: 14, background: C.light }} showCloseButton={false}>
      <PopupHeader title="判定项与权重配置" onClose={onClose} />
      <div style={{ padding: 12, overflow: 'auto', height: 'calc(86vh - 108px)' }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>
          {doc?.formula || '总分 = Σ(模块得分[0-100] × 权重) ÷ Σ(启用权重)'}
          <div style={{ marginTop: 4 }}>
            启用模块权重之和：<strong style={{ color: C.primary }}>{fmt(enabledSum, 0)}%</strong>
            <span style={{ color: '#bbb' }}>（总分按此归一化；关掉某个模块或脚本没回传时，其权重自动从分母剔除）</span>
          </div>
        </div>

        {list.map(c => (
          <div key={c.code} style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Switch checked={!!c.enabled} onChange={(v) => patch(c.code, { enabled: v })} style={{ '--checked-color': C.primary }} />
              <span style={{ fontSize: 14, fontWeight: 700, color: c.enabled ? C.primary : '#aaa' }}>{c.name}</span>
              <span style={{ fontSize: 10, color: '#bbb' }}>{c.code}</span>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: '#999' }}>权重%</span>
              <input type="number" min="0" max="100" value={c.weight} onChange={(e) => patch(c.code, { weight: e.target.value })}
                style={{ width: 60, fontSize: 13, padding: '2px 6px', borderRadius: 6, border: `1px solid ${C.tag}`, color: C.primary, textAlign: 'center' }} />
            </div>
            {(c.items || []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {c.items.map(it => (
                  <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', fontSize: 12 }}>
                    <span style={{ flex: 1, color: '#555' }}>{it.label}</span>
                    <input type="number" value={it.points} onChange={(e) => patchItem(c.code, it.id, { points: e.target.value })}
                      style={{ width: 54, fontSize: 12, padding: '1px 5px', borderRadius: 6, border: `1px solid ${C.tag}`, color: C.accent, textAlign: 'center' }} />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {/* 模块阈值（窗口/倍数/容差）：只读，唯一真源在配置文件 */}
        <div style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, marginBottom: 2 }}>模块阈值（来自 fortune_criteria.json · module_params）</div>
          <div style={{ fontSize: 10, color: '#999', marginBottom: 6, lineHeight: 1.5 }}>
            只读：改阈值需改配置文件并重启后端；页面改权重/开关/子项分值即时生效。
          </div>
          {Object.keys(doc?.moduleParams || {}).length === 0 && (
            <div style={{ fontSize: 11, color: '#bbb' }}>配置未提供 module_params（脚本将退回内置默认阈值）</div>
          )}
          {Object.entries(doc?.moduleParams || {}).map(([k, v]) => (
            <div key={k} style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11, padding: '3px 0', borderBottom: '1px dashed #f2f2f2' }}>
              <span style={{ flex: 1, color: '#666' }}>
                {PARAM_LABEL[k] || k}
                <span style={{ color: '#ccc', marginLeft: 4, fontSize: 10 }}>{k}</span>
              </span>
              <b style={{ color: C.accent, fontWeight: 700 }}>{paramText(v)}</b>
            </div>
          ))}
        </div>

        {/* ==================== 衰竭止盈模块（W） ==================== */}
        {sellList.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#b3261e', margin: '14px 0 8px' }}>🔻 衰竭风险评估 · 卖出警示打分</div>
            <div style={{ fontSize: 10, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>
              与买入分独立：每组开关 + 子项分值即时保存；当前启用子项满分合计 <b style={{ color: sellMaxSum === 100 ? C.primary : '#b3261e' }}>{sellMaxSum}</b> 分
              （按启用且适用子项满分归一到 0~100，合计不等于 100 也能正常出分）。
              衰竭分是概率性风险提示，非强制卖出信号。
            </div>

            {sellList.map(c => (
              <div key={c.code} style={{ background: '#fff', border: '1px solid #f0c8c4', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch checked={!!c.enabled} onChange={(v) => patchSell(c.code, { enabled: v })} style={{ '--checked-color': '#b3261e' }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: c.enabled ? C.text : '#aaa' }}>{c.name}</span>
                  <span style={{ fontSize: 10, color: '#bbb' }}>{c.code}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#999' }}>组满分</span>
                  <b style={{ fontSize: 12, color: '#b3261e' }}>{(c.items || []).reduce((s, it) => s + (Number(it.points) || 0), 0)}</b>
                </div>
                <div style={{ marginTop: 6 }}>
                  {(c.items || []).map(it => (
                    <div key={it.id} style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ flex: 1, color: '#555' }} title={it.desc || ''}>{it.label}<span style={{ color: '#ccc', marginLeft: 4, fontSize: 10 }}>{it.id}</span></span>
                        <input type="number" value={it.points} onChange={(e) => patchSellItem(c.code, it.id, { points: e.target.value })}
                          style={{ width: 54, fontSize: 12, padding: '1px 5px', borderRadius: 6, border: `1px solid ${C.tag}`, color: C.accent, textAlign: 'center' }} />
                      </div>
                      {Array.isArray(it.tiers) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#999', paddingLeft: 12, marginTop: 2 }}>
                          分档分值（轻/明显/严重）：
                          {it.tiers.map((t, ti) => (
                            <input key={ti} type="number" value={t}
                              onChange={(e) => { const next = [...it.tiers]; next[ti] = Number(e.target.value) || 0; patchSellItem(c.code, it.id, { tiers: next }) }}
                              style={{ width: 40, fontSize: 11, padding: '1px 4px', borderRadius: 5, border: `1px solid ${C.tag}`, color: '#b3261e', textAlign: 'center' }} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* 归一模式 + 等级区间 */}
            <div style={{ background: '#fff', border: '1px solid #f0c8c4', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b3261e', marginBottom: 6 }}>衰竭分归一模式</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[['A', 'A · 启用子项满分归一（推荐）'], ['B', 'B · 直接累加封顶 100']].map(([k, label]) => (
                  <span key={k} onClick={() => setSellMode(k)}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 12, cursor: 'pointer', flex: 1, textAlign: 'center',
                      background: sellMode === k ? '#b3261e' : '#fff', color: sellMode === k ? '#fff' : '#999', border: '1px solid #f0c8c4' }}>{label}</span>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#999', marginTop: 4, lineHeight: 1.5 }}>
                A：衰竭分 = 命中分值 ÷ 启用且适用子项满分 ×100，关掉某组不影响读数口径；B：命中分值直接累加，关闭组少则天然偏严。
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b3261e', margin: '10px 0 4px' }}>等级区间（分数 ≥min 且 &lt;max 归入该级）</div>
              {sellBands.map((b, i) => (
                <div key={b.code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0', borderBottom: '1px dashed #f6e9e7' }}>
                  <span style={{ color: b.color, fontWeight: 700, width: 78 }}>{b.icon || ''} {b.label}</span>
                  <input type="number" value={b.min} onChange={(e) => setSellBands(prev => prev.map((x, xi) => xi === i ? { ...x, min: e.target.value } : x))}
                    style={{ width: 54, fontSize: 11, padding: '1px 4px', borderRadius: 5, border: '1px solid #f0c8c4', textAlign: 'center' }} />
                  <span style={{ color: '#bbb' }}>—</span>
                  <input type="number" value={b.max} onChange={(e) => setSellBands(prev => prev.map((x, xi) => xi === i ? { ...x, max: e.target.value } : x))}
                    style={{ width: 60, fontSize: 11, padding: '1px 4px', borderRadius: 5, border: '1px solid #f0c8c4', textAlign: 'center' }} />
                  <input type="text" value={b.advice || ''} onChange={(e) => setSellBands(prev => prev.map((x, xi) => xi === i ? { ...x, advice: e.target.value } : x))}
                    style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '1px 6px', borderRadius: 5, border: '1px solid #f0c8c4', color: '#888' }} />
                </div>
              ))}
            </div>

            {/* 两套综合分（S_A/S_B）参数 + 筹码限流 */}
            <div style={{ background: '#fff', border: '1px solid #f0c8c4', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b3261e', marginBottom: 2 }}>综合分与筹码限流</div>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 6, lineHeight: 1.5 }}>
                惩罚公式（两套同构）：raw = 基础分×wA − 衰竭分×wB，钳位 [{-100 * ovNum('wB', 0.2)}, {100 * ovNum('wA', 0.8)}] 后加 {100 * ovNum('wB', 0.2)} → 输出恒定 0～100。
                基础分取买入分（趋势）得 <b>趋势综合分</b>（趋势池排序）、取反转分得 <b>反转综合分</b>（反转池排序）；wA+wB 保持 1 才是标准 0～100 区间。
                旧的高位争议强制压低（veto）与硬拦截分流观察池已废除（衰竭惩罚已在公式内）。
              </div>
              {Object.entries(openVal).map(([k, v]) => paramRow(k, v, setOpenVal, doc?.sellDefaults?.openValue, false))}
              <div style={{ fontSize: 12, fontWeight: 700, color: '#b3261e', margin: '10px 0 4px' }}>两级打分限流（chip）</div>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 6, lineHeight: 1.5 }}>
                粗筛一轮最多 {chipCfg.batch_max_pre_filter ?? 100} 只、一律不请求筹码（筹码分项记 0）；精选取反转综合分靠前 {chipCfg.select_max_chip ?? 10} 只，
                Node 串行逐只拉真实筹码 ak.stock_cyq_em（并发恒为 1、间隔 {chipCfg.chip_request_interval ?? 1000}ms、单只超时 {chipCfg.chip_timeout ?? 60000}ms）。
                接口失败只把 B7 记 0 并标注，整批不中断。历史时间点不请求实时筹码。
              </div>
              {Object.entries(chipCfg).map(([k, v]) => paramRow(k, v, setChipCfg, doc?.sellDefaults?.chip, false))}
            </div>

            {/* wp_* 阈值（页面可改，覆盖存 SystemConfig） */}
            <div style={{ background: '#fff', border: '1px solid #f0c8c4', borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#b3261e', flex: 1 }}>衰竭判定阈值（wp_*）</span>
                <Button size="mini" fill="outline" style={{ '--border-color': '#d9a5a0', '--text-color': '#b3261e' }} onClick={resetSell}>清除覆盖</Button>
              </div>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 6, lineHeight: 1.5 }}>
                保存后随每次打分下发给判定脚本（↺ 单项回到文件默认；「清除覆盖」整体回到 fortune_criteria.json）。
              </div>
              {Object.entries(sellParams).map(([k, v]) => paramRow(k, v, setSellParams, doc?.sellDefaults?.sellParams, Array.isArray((doc?.sellDefaults || {}).sellParams?.[k])))}
            </div>
          </>
        )}

        {/* ==================== 超跌反转模块（B）与筹码 ==================== */}
        {revList.length > 0 && (
          <>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.primary, margin: '14px 0 8px' }}>🔄 反转打分模块 · 与筹码</div>
            <div style={{ fontSize: 10, color: '#999', marginBottom: 8, lineHeight: 1.6 }}>
              与买入分（趋势）/ 衰竭分完全独立：B1～B7 命中分值累加封顶 100（七个组全开时满分合计 <b style={{ color: revMaxSum === 100 ? C.primary : '#b3261e' }}>{revMaxSum}</b> 分，互斥组取最高档），不参与任何加权。
              <br /><b style={{ color: revAnyOn ? C.primary : '#b3261e' }}>整组可开关（默认开启）</b>：关闭时反转分与反转综合分记「未判定」（不是 0 分），反转池不可用；关掉后不再提示底部结构，只剩纯趋势口径。
              整组前置：现价距 60 日高回撤 ≥ {revParams.bp_drawdown_min_pct ?? 15}%，不算超跌则 B1～B7 全不计分。
              B7 只用真实筹码接口（ak.stock_cyq_em），绝不拿日线近似估算。
            </div>

            {revList.map(c => (
              <div key={c.code} style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Switch checked={!!c.enabled} onChange={(v) => patchRev(c.code, { enabled: v })} style={{ '--checked-color': C.primary }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: c.enabled ? C.text : '#aaa' }}>{c.name}</span>
                  <span style={{ fontSize: 10, color: '#bbb' }}>{c.code}{c.exclusive ? ' · 组内互斥' : ''}</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 10, color: '#999' }}>组满分</span>
                  <b style={{ fontSize: 12, color: C.primary }}>
                    {revGroupMax(c)}
                  </b>
                </div>
                <div style={{ marginTop: 6 }}>
                  {(c.items || []).map(it => (
                    <div key={it.id} style={{ marginBottom: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ flex: 1, color: '#555' }} title={it.desc || ''}>
                          {it.label}<span style={{ color: '#ccc', marginLeft: 4, fontSize: 10 }}>{it.id}</span>
                          {it.theory && <span style={{ display: 'block', fontSize: 10, color: C.accent }}>理论来源：{it.theory}</span>}
                        </span>
                        <input type="number" value={it.points} onChange={(e) => patchRevItem(c.code, it.id, { points: e.target.value })}
                          style={{ width: 54, fontSize: 12, padding: '1px 5px', borderRadius: 6, border: `1px solid ${C.tag}`, color: C.accent, textAlign: 'center' }} />
                      </div>
                      {Array.isArray(it.tiers) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#999', paddingLeft: 12, marginTop: 2 }}>
                          分档分值（轻/明显/深度）：
                          {it.tiers.map((t, ti) => (
                            <input key={ti} type="number" value={t}
                              onChange={(e) => { const next = [...it.tiers]; next[ti] = Number(e.target.value) || 0; patchRevItem(c.code, it.id, { tiers: next }) }}
                              style={{ width: 40, fontSize: 11, padding: '1px 4px', borderRadius: 5, border: `1px solid ${C.tag}`, color: C.primary, textAlign: 'center' }} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {/* B 分等级区间（四级） */}
            <div style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, marginBottom: 4 }}>反转分等级区间（分数 ≥min 且 &lt;max 归入该级）</div>
              {revBands.map((b, i) => (
                <div key={b.code} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '3px 0', borderBottom: '1px dashed #f4ecec' }}>
                  <span style={{ color: b.color, fontWeight: 700, width: 88 }}>{b.icon || ''} {b.label}</span>
                  <input type="number" value={b.min} onChange={(e) => setRevBands(prev => prev.map((x, xi) => xi === i ? { ...x, min: e.target.value } : x))}
                    style={{ width: 54, fontSize: 11, padding: '1px 4px', borderRadius: 5, border: `1px solid ${C.tag}`, textAlign: 'center' }} />
                  <span style={{ color: '#bbb' }}>—</span>
                  <input type="number" value={b.max} onChange={(e) => setRevBands(prev => prev.map((x, xi) => xi === i ? { ...x, max: e.target.value } : x))}
                    style={{ width: 60, fontSize: 11, padding: '1px 4px', borderRadius: 5, border: `1px solid ${C.tag}`, textAlign: 'center' }} />
                  <input type="text" value={b.advice || ''} onChange={(e) => setRevBands(prev => prev.map((x, xi) => xi === i ? { ...x, advice: e.target.value } : x))}
                    style={{ flex: 1, minWidth: 0, fontSize: 11, padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.tag}`, color: '#888' }} />
                </div>
              ))}
              <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
                反转赛道胜率天然低于趋势赛道：🟠 才进反转候选池，🔴 才是共振标的，都要严格止损。
              </div>
            </div>

            {/* bp_* 阈值（页面可改，覆盖存 SystemConfig） */}
            <div style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 2 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.primary, flex: 1 }}>反转判定阈值（bp_*）</span>
                <Button size="mini" fill="outline" style={{ '--border-color': C.accent, '--text-color': C.primary }} onClick={resetSell}>清除覆盖</Button>
              </div>
              <div style={{ fontSize: 10, color: '#999', marginBottom: 6, lineHeight: 1.5 }}>
                这些阈值只在后端 JS 侧生效（不下发 Python）；↺ 单项回到文件默认，「清除覆盖」整体回到 fortune_criteria.json。
              </div>
              {Object.entries(revParams).map(([k, v]) => paramRow(k, v, setRevParams, doc?.sellDefaults?.reversalParams, Array.isArray((doc?.sellDefaults || {}).reversalParams?.[k])))}
            </div>
          </>
        )}

        <div style={{ background: '#fff', border: `1px dashed ${C.accent}`, borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.primary, marginBottom: 6 }}>新增判定项</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Input placeholder="编码 如 volume" value={newCode} onChange={setNewCode} style={{ '--font-size': '13px', flex: 1 }} />
            <Input placeholder="名称 如 量能理论" value={newName} onChange={setNewName} style={{ '--font-size': '13px', flex: 1 }} />
            <Button size="small" color="primary" style={{ '--background-color': C.primary, '--border-color': C.primary }} onClick={addCriterion}>添加</Button>
          </div>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, display: 'flex', gap: 10, padding: 12, background: '#fff', borderTop: `1px solid ${C.tag}` }}>
        <Button block fill="outline" onClick={reset} style={{ '--border-color': C.accent, '--text-color': C.accent }}>恢复出厂</Button>
        <Button block color="primary" loading={saving} style={{ '--background-color': C.primary, '--border-color': C.primary }} onClick={save}>保存</Button>
      </div>
    </Popup>
  )
}
