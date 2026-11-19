// ===== 成交额「较昨日此时」序列（S）逐分钟告警 v2（首页大盘 / 自选单票共用）=====
// S = 当日累计成交额 - 昨日同时刻累计（单位：亿）；dS = 相邻两分钟 S 的变化
// 分层：基础趋势标签（F/E/A/B/D/C/持续放量/持续缩量/小幅修复/多空切换）→ 满足震荡条件再追加｜🟡震荡拉锯
// 注：「前 3 根」取当前 dS 之前的 3 根（不含当前，否则 A/B 永不可达）

// 格式化成交额（元 → 亿/万）
export const formatAmount = (yuan) => {
  if (!yuan || yuan === 0) return '--'
  if (yuan >= 1e8) return (yuan / 1e8).toFixed(2) + '亿'
  if (yuan >= 1e4) return (yuan / 1e4).toFixed(0) + '万'
  return yuan.toFixed(0)
}

// 格式化增量（带正负号与颜色）
export const formatIncrement = (yuan) => {
  if (!yuan || yuan === 0) return { text: '--', color: '#999' }
  const abs = Math.abs(yuan)
  const formatted = abs >= 1e8
    ? (abs / 1e8).toFixed(2) + '亿'
    : abs >= 1e4
      ? (abs / 1e4).toFixed(0) + '万'
      : abs.toFixed(0)
  if (yuan > 0) return { text: '+' + formatted, color: '#e74c3c' }
  return { text: '-' + formatted, color: '#27ae60' }
}

// 格式化成交量（股 → 亿股/万手/手；1手=100股）
export const formatVolume = (shares) => {
  if (!shares || shares <= 0) return '--'
  if (shares >= 1e8) return (shares / 1e8).toFixed(2) + '亿股'
  if (shares >= 1e6) return (shares / 1e6).toFixed(1) + '万手'
  return Math.round(shares / 100) + '手'
}

// 格式化成交量差值（带正负号与颜色，涨红跌绿）
export const formatVolumeDiff = (shares) => {
  if (!shares || shares === 0) return { text: '--', color: '#999' }
  const abs = Math.abs(shares)
  const formatted = abs >= 1e8
    ? (abs / 1e8).toFixed(2) + '亿股'
    : abs >= 1e6
      ? (abs / 1e6).toFixed(1) + '万手'
      : Math.round(abs / 100) + '手'
  if (shares > 0) return { text: '+' + formatted, color: '#e74c3c' }
  return { text: '-' + formatted, color: '#27ae60' }
}

export const ALERT_OPTS = {
  windowOsc: 4,            // 震荡判断窗口dS数量
  windowTrendPre: 3,       // 趋势前置连续 3 根（不含当前分钟）
  windowMean: 5,           // 均值基准窗口
  oscAmplitudeThresh: 20,  // 震荡最小振幅（亿），15→20 放宽，小幅毛刺不再判震荡
  upThreshMultiple: 2,     // A/E/F 触发倍数
  downThreshMultiple: 0.5, // B/C/D 衰减倍数
}

// 标签颜色：⚠️强告警红 / ℹ️观察蓝 / 稳态（持续放量/持续缩量/小幅修复等）灰
export const ALERT_COLORS = {
  F: '#e74c3c', E: '#e74c3c', A: '#e74c3c', B: '#e74c3c',
  D: '#1677ff', C: '#1677ff',
}

export function calcVolumeAlert(sList, opts = ALERT_OPTS) {
  const { windowOsc, windowTrendPre, windowMean, oscAmplitudeThresh, upThreshMultiple, downThreshMultiple } = opts
  const result = []
  const dSList = []
  for (let idx = 0; idx < sList.length; idx++) {
    const s = sList[idx]
    const item = { time_index: idx, S: s, dS: null, base_type: 'steady', base_label: '基准', is_osc: false, final_label: '基准，无信号' }
    if (idx === 0) { result.push(item); continue }

    const ds = s - sList[idx - 1]
    dSList.push(ds)
    item.dS = Math.round(ds * 100) / 100

    // dS 不足 4 根：只给方向说明，不判震荡和加速
    if (dSList.length < windowOsc) {
      item.base_type = ds > 0 ? 'recover' : 'weaken'
      item.base_label = ds > 0 ? '修复（变强）' : '缺口扩大（变弱）'
      item.final_label = item.base_label
      result.push(item)
      continue
    }

    // 第一步：震荡判断（只标记，不阻断基础标签）
    const oscWindow = dSList.slice(-windowOsc)
    const hasPos = oscWindow.some(x => x > 0)
    const hasNeg = oscWindow.some(x => x < 0)
    const amp = Math.max(...oscWindow) - Math.min(...oscWindow)
    item.is_osc = hasPos && hasNeg && amp >= oscAmplitudeThresh

    // 第二步：基础趋势标签（每行必出文字，无空白）
    const trendPre = dSList.slice(-(windowTrendPre + 1), -1) // 之前 3 根，不含当前
    const meanWindow = dSList.slice(-windowMean)
    const meanDS = meanWindow.reduce((a, b) => a + b, 0) / meanWindow.length
    const absMeanDS = meanWindow.reduce((a, b) => a + Math.abs(b), 0) / meanWindow.length
    const currDs = ds
    let baseType = 'cross'
    let baseLabel = '多空切换'

    if (trendPre.every(x => x > 0)) {
      // F 加速 → B 退潮（转负） → D 减速（仍正但明显乏力） → 持续放量（匀速）
      if (trendPre[1] > trendPre[0] && trendPre[2] > trendPre[1] && currDs > upThreshMultiple * absMeanDS) {
        baseType = 'F'; baseLabel = '⚠️放量加速'
      } else if (currDs < 0) {
        baseType = 'B'; baseLabel = '⚠️放量退潮'
      } else if (currDs < downThreshMultiple * meanDS) {
        baseType = 'D'; baseLabel = 'ℹ️放量减速'
      } else {
        baseType = 'steady_long'; baseLabel = '持续放量'
      }
    } else if (trendPre.every(x => x < 0)) {
      // E 加速 → 转正则小幅修复 → C 减速 → 持续缩量（匀速）
      if (trendPre[1] < trendPre[0] && trendPre[2] < trendPre[1] && Math.abs(currDs) > upThreshMultiple * absMeanDS) {
        baseType = 'E'; baseLabel = '⚠️缩量加速'
      } else if (currDs > 0) {
        baseType = 'recover'; baseLabel = '小幅修复'
      } else if (Math.abs(currDs) < downThreshMultiple * absMeanDS) {
        baseType = 'C'; baseLabel = 'ℹ️缩量减速'
      } else {
        baseType = 'steady_short'; baseLabel = '持续缩量'
      }
    } else if (trendPre.every(x => x <= 0)) {
      // A 缩量转强拐点：前置连续<=0，当前大幅正向修复
      if (currDs > upThreshMultiple * absMeanDS) {
        baseType = 'A'; baseLabel = '⚠️缩量快速修复'
      } else {
        baseType = 'recover'; baseLabel = '小幅修复'
      }
    }

    item.base_type = baseType
    item.base_label = baseLabel
    // 第三步：拼接最终展示标签（震荡作后缀叠加）
    item.final_label = item.is_osc ? `${baseLabel}｜🟡震荡拉锯` : baseLabel
    result.push(item)
  }
  return result
}

// 给定「今日累计 / 昨日同刻累计」与除数单位（成交额：元/1e8=亿；成交量：股/1e8=亿股），产出按时刻索引的告警结果 map
// 单票量能远小于大盘，震荡绝对振幅阈值（20亿）对单票基本不触发，等效关闭震荡叠加，无需另调
export function buildAlertMap(times, cumList, prevCumList, divisor = 1e8) {
  const alertMap = {}
  const sList = []
  const keys = []
  for (let i = 0; i < times.length; i++) {
    const prev = prevCumList[i]
    if (prev == null || cumList[i] == null) continue
    sList.push((cumList[i] - prev) / divisor)
    keys.push(times[i])
  }
  if (!sList.length) return alertMap
  const res = calcVolumeAlert(sList)
  res.forEach((r, i) => { alertMap[keys[i]] = { ...r, sPrev: i > 0 ? sList[i - 1] : null } })
  return alertMap
}
