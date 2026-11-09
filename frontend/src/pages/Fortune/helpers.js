/**
 * 胡胖胖招财进宝 —— 前端共享工具
 * deriveScore / computeTotal / resolveBand 与后端 fortuneService 保持同一口径，
 * 页面用它做实时预览；保存仍以服务端计算为准。
 */

export const C = {
  primary: '#8B3A42', accent: '#C4737A', tag: '#F5E6E8', light: '#FAF0F1', track: '#E8CED1',
  up: '#e74c3c', down: '#27ae60', text: '#666',
}

export const fmt = (v, n = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(n))

/** 子项勾选折算该项 0-100 分（勾选项分值之和 / 正分满分 ×100，风险负分从中间扣减后夹到 0~100） */
export function deriveScore(items, checkedIds) {
  const list = Array.isArray(items) ? items : []
  const checked = new Set(Array.isArray(checkedIds) ? checkedIds : [])
  const positiveMax = list.filter(x => (Number(x.points) || 0) > 0)
    .reduce((s, x) => s + Number(x.points), 0)
  if (!positiveMax) return 0
  let sum = 0
  for (const x of list) if (checked.has(x.id)) sum += Number(x.points) || 0
  return Math.max(0, Math.min(100, Math.round(sum / positiveMax * 100)))
}

/** 该项有效分：有覆盖用覆盖，否则用勾选折算 */
export function criterionScore(criterion, state) {
  if (!state) return 0
  if (state.scoreOverride !== null && state.scoreOverride !== undefined && state.scoreOverride !== '') {
    return Math.max(0, Math.min(100, Number(state.scoreOverride) || 0))
  }
  return deriveScore(criterion.items, state.checked)
}

/** 加权总分 + 每项明细（仅启用项参与） */
export function computeTotal(criteria, scoreStates) {
  const active = criteria.filter(c => c.enabled)
  const details = active.map(c => {
    const score = criterionScore(c, scoreStates[c.code])
    const weighted = Number((score * c.weight / 100).toFixed(2))
    return { code: c.code, name: c.name, weight: c.weight, score, weighted }
  })
  const total = Number(details.reduce((s, d) => s + d.weighted, 0).toFixed(2))
  const weightSum = Number(active.reduce((s, c) => s + Number(c.weight), 0).toFixed(2))
  return { total, details, weightSum }
}

/** 分档归类 */
export function resolveBand(total, bands) {
  const list = bands || []
  const hit = list.find(b => total >= Number(b.min) && total < Number(b.max))
  if (hit) return hit
  return list[list.length - 1] || { code: '', label: '', color: '#999', advice: '' }
}

/**
 * 把 K 线数据截断到 asOfDate（含当天），供复盘"看当时到哪根 K"。
 * asOfDate 为空或晚于最后一根时原样返回。
 */
export function trimKline(kline, asOfDate) {
  if (!kline || !Array.isArray(kline.dates) || !asOfDate) return kline
  let end = kline.dates.length
  for (let i = kline.dates.length - 1; i >= 0; i--) {
    if (String(kline.dates[i]).slice(0, 10) <= asOfDate) { end = i + 1; break }
    if (i === 0) end = 0
  }
  if (end === kline.dates.length) return { ...kline, today_live: false }
  const sliced = arr => (Array.isArray(arr) ? arr.slice(0, end) : arr)
  const ma = {}
  Object.keys(kline.ma || {}).forEach(k => { ma[k] = sliced(kline.ma[k]) })
  const macd = {}
  Object.keys(kline.macd || {}).forEach(k => { macd[k] = sliced(kline.macd[k]) })
  return {
    ...kline,
    dates: sliced(kline.dates),
    bars: sliced(kline.bars),
    ma,
    macd,
    today_live: false,
  }
}

/** 本地 yyyy-mm-dd（北京时区口径与后端一致的简单版） */
export function todayStr() {
  const d = new Date(Date.now() + 8 * 3600 * 1000)
  return d.toISOString().slice(0, 10)
}
