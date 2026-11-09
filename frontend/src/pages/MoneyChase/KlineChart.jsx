/**
 * 每日追资金 —— 日 K 线可视化（ECharts 蜡烛图 + 规则标注）
 *
 * 数据来源：fetch_money_chase.py 的 kline 字段（后端 MoneyChaseCandidate.kline 原样返回）
 *   bars    [开, 收, 低, 高, 量, 额, 换手, 涨幅]  ← 与 ECharts candlestick 的 [open, close, lowest, highest] 同序
 *   marks   混合数组：{date,price,kind} 标注点 / {seg,high,high_date,low,low_date} 道氏分段 / {date,kind:'fail'|'redline',text}
 *   panel   指标数值面板
 *
 * 标注可按需开关（均线 / 道氏 / 斐波那契 / 回撤 / 失败点 / 背离 / 颈线），
 * 目的是让「不符合哪一项」在图上看得到、也写得清。
 */
import React, { useMemo, useState } from 'react'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import { CandlestickChart, BarChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  MarkLineComponent, MarkPointComponent, MarkAreaComponent, AxisPointerComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  CandlestickChart, BarChart, LineChart, ScatterChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  MarkLineComponent, MarkPointComponent, MarkAreaComponent, AxisPointerComponent,
  CanvasRenderer,
])

const C = {
  up: '#e74c3c',
  down: '#27ae60',
  primary: '#8B3A42',
  accent: '#C4737A',
  light: '#FAF0F1',
  tag: '#F5E6E8',
  grid: '#eee',
  text: '#666',
}

const OVERLAY_LABELS = {
  ma: '均线',
  dow_points: '道氏高低点',
  fib: '斐波那契',
  retrace: '60日高低/回撤',
  fail_dots: '未达标点',
  divergence: '顶背离连线',
  neckline: 'M头颈线',
  today_bar: '当日未收盘',
}

function fmt(v, n = 2) {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '—'
  return Number(v).toFixed(n)
}

/** 把同一天、同一类的标注点合并成一个，避免标签叠在一起看不清 */
function groupMarks(marks, kind) {
  const map = {}
  for (const m of marks) {
    if (m.kind !== kind || !m.date) continue
    if (!map[m.date]) map[m.date] = []
    map[m.date].push(m.text || '')
  }
  return Object.entries(map).map(([date, texts]) => ({ date, text: texts.filter(Boolean).join('\n') }))
}

export default function KlineChart({ kline, pool = 'A', name = '', symbol = '' }) {
  const overlays = kline?.overlays || []
  const defaultOn = useMemo(() => {
    const on = {}
    Object.keys(OVERLAY_LABELS).forEach((code) => { on[code] = overlays.includes(code) })
    return on
  }, [overlays])
  const [show, setShow] = useState(defaultOn)

  const option = useMemo(() => {
    if (!kline || !Array.isArray(kline.bars) || !kline.bars.length) return null
    const dates = kline.dates
    const bars = kline.bars
    const last = bars.length - 1
    const isLive = !!kline.today_live
    const marks = Array.isArray(kline.marks) ? kline.marks : []
    const dowMarks = marks.filter(m => m && m.seg)
    const priced = marks.filter(m => m && m.date && m.price != null && ['div_high', 'm_head', 'neckline'].includes(m.kind))
    const failMarks = groupMarks(marks, 'fail')
    const redMarks = groupMarks(marks, 'redline')
    const panel = kline.panel || {}
    const fib = panel.fib || kline.fib_info || {}

    // 蜡烛：[开, 收, 低, 高]
    const candle = bars.map((b, i) => {
      const value = [b[0], b[1], b[2], b[3]]
      if (i === last && isLive) {
        return { value, itemStyle: { borderType: 'dashed', borderColor: C.primary, borderWidth: 1.6 } }
      }
      return value
    })

    // ---- markLine（水平参考线）
    const lines = []
    if (show.fib) {
      [['fib382', '0.382'], ['fib500', '0.5'], ['fib618', '0.618']].forEach(([key, tag]) => {
        const v = fib[key]
        if (v == null) return
        const active = fib.near === key
        lines.push({
          yAxis: v,
          lineStyle: { color: active ? C.primary : C.accent, width: active ? 1.6 : 1, type: active ? 'solid' : 'dashed', opacity: active ? 0.95 : 0.6 },
          label: { show: true, position: 'insideEndTop', formatter: `fib ${tag} ${fmt(v)}`, color: active ? C.primary : C.accent, fontSize: 9 },
        })
      })
    }
    if (show.retrace) {
      if (panel.high60 != null) lines.push({ yAxis: panel.high60, lineStyle: { color: C.up, type: 'dotted', width: 1 }, label: { show: true, position: 'insideEndTop', formatter: `60日高 ${fmt(panel.high60)}`, color: C.up, fontSize: 9 } })
      if (panel.low60 != null) lines.push({ yAxis: panel.low60, lineStyle: { color: C.down, type: 'dotted', width: 1 }, label: { show: true, position: 'insideEndBottom', formatter: `60日低 ${fmt(panel.low60)}`, color: C.down, fontSize: 9 } })
    }
    if (show.neckline) {
      priced.filter(m => m.kind === 'neckline').forEach(m => {
        lines.push({ yAxis: m.price, lineStyle: { color: C.primary, type: 'solid', width: 1.4 }, label: { show: true, position: 'insideMiddle', formatter: `颈线 ${fmt(m.price)} 已破=反转确认`, color: C.primary, fontSize: 9, fontWeight: 600 } })
      })
    }

    // ---- markPoint（图形标记）
    const points = []
    if (show.dow_points) {
      dowMarks.forEach(m => {
        if (m.high_date) points.push({ coord: [m.high_date, m.high], symbol: 'triangle', symbolSize: 9, itemStyle: { color: C.up }, label: { show: true, position: 'top', formatter: `H${m.seg}`, fontSize: 9, color: C.up } })
        if (m.low_date) points.push({ coord: [m.low_date, m.low], symbol: 'triangle', symbolRotate: 180, symbolSize: 9, itemStyle: { color: C.down }, label: { show: true, position: 'bottom', formatter: `L${m.seg}`, fontSize: 9, color: C.down } })
      })
      priced.filter(m => m.kind === 'm_head').forEach((m, i) => {
        points.push({ coord: [m.date, m.price], symbol: 'pin', symbolSize: 26, itemStyle: { color: C.accent }, label: { show: true, formatter: `顶${i + 1}`, fontSize: 9, color: '#fff' } })
      })
    }
    if (show.divergence) {
      priced.filter(m => m.kind === 'div_high').forEach(m => {
        points.push({ coord: [m.date, m.price], symbol: 'circle', symbolSize: 8, itemStyle: { color: C.primary }, label: { show: true, position: 'top', formatter: '价新高', fontSize: 9, color: C.primary } })
      })
    }
    if (show.fail_dots) {
      failMarks.forEach(m => points.push({ coord: [m.date, (bars[dates.indexOf(m.date)] || [])[2] || 0], symbol: 'circle', symbolSize: 7, itemStyle: { color: C.accent, opacity: 0.85 }, label: { show: true, position: 'bottom', formatter: m.text, fontSize: 9, color: C.accent, width: 90 } }))
      redMarks.forEach(m => points.push({ coord: [m.date, (bars[dates.indexOf(m.date)] || [])[3] || 0], symbol: 'diamond', symbolSize: 11, itemStyle: { color: C.up }, label: { show: true, position: 'top', formatter: m.text, fontSize: 10, fontWeight: 700, color: C.up } }))
    }

    // ---- 连线系列（道氏抬升 / 顶背离）
    const hiPts = dowMarks.filter(m => m.high_date).map(m => [m.high_date, m.high])
    const loPts = dowMarks.filter(m => m.low_date).map(m => [m.low_date, m.low])
    const divPts = priced.filter(m => m.kind === 'div_high').sort((a, b) => dates.indexOf(a.date) - dates.indexOf(b.date))

    const series = [
      {
        name: '日K', type: 'candlestick', data: candle, xAxisIndex: 0, yAxisIndex: 0,
        itemStyle: { color: C.up, color0: C.down, borderColor: C.up, borderColor0: C.down, borderWidth: 1 },
        markLine: lines.length ? { symbol: 'none', animation: false, data: lines, silent: true } : undefined,
        markPoint: points.length ? { data: points, silent: true } : undefined,
        markArea: (show.fib && fib.near && fib[fib.near] != null && panel.price != null) ? {
          silent: true,
          itemStyle: { color: C.light, opacity: 0.75 },
          data: [[{ yAxis: Number(fib[fib.near]) * 0.985 }, { yAxis: Number(fib[fib.near]) * 1.015 }]],
        } : undefined,
      },
    ]

    const maKeys = Object.keys(kline.ma || {})
    if (show.ma && maKeys.length) {
      maKeys.sort((a, b) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''))).forEach((key, i) => {
        series.push({
          name: key.toUpperCase(), type: 'line', data: kline.ma[key], xAxisIndex: 0, yAxisIndex: 0,
          smooth: true, showSymbol: false, connectNulls: false,
          lineStyle: { width: 1.2, color: i === 0 ? C.primary : i === 1 ? C.accent : '#C27078' },
          z: 3,
        })
      })
    }

    if (show.dow_points && hiPts.length >= 2) {
      series.push({ name: '道氏高点', type: 'line', data: hiPts, xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, lineStyle: { type: 'dashed', color: C.up, width: 1 }, z: 4 })
      series.push({ name: '道氏低点', type: 'line', data: loPts, xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, lineStyle: { type: 'dashed', color: C.down, width: 1 }, z: 4 })
    }
    if (show.divergence && divPts.length >= 2) {
      series.push({ name: '价格背离线', type: 'line', data: divPts.map(p => [p.date, p.price]), xAxisIndex: 0, yAxisIndex: 0, showSymbol: false, lineStyle: { type: 'solid', color: C.primary, width: 1.6 }, z: 5 })
      series.push({ name: 'DIF背离线', type: 'line', data: divPts.map(p => [p.date, p.dif]), xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { type: 'solid', color: C.primary, width: 1.6 }, z: 5 })
    }

    series.push({
      name: '成交量', type: 'bar', data: bars.map((b, i) => ({ value: b[4], itemStyle: { color: (b[1] >= b[0] ? C.up : C.down), opacity: i === last && isLive ? 0.55 : 0.7 } })),
      xAxisIndex: 1, yAxisIndex: 1, barWidth: '62%',
    })
    if (isLive && kline.vol_scale && kline.vol_scale < 1) {
      // 盘中：把折算后的全天估算量画成细柱，便于和 20 日均量比较
      series.push({
        name: '折算全天量', type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barGap: '-100%', barWidth: '22%',
        data: bars.map((b, i) => ({
          value: i === last ? (b[4] == null ? null : b[4] / kline.vol_scale) : null,
          itemStyle: { color: C.primary, opacity: 0.9 },
        })),
        z: 6,
      })
    }

    const macd = kline.macd || {}
    series.push({
      name: 'MACD', type: 'bar', xAxisIndex: 2, yAxisIndex: 2, barWidth: '62%',
      data: (macd.bar || []).map(v => ({ value: v, itemStyle: { color: v >= 0 ? C.up : C.down, opacity: 0.7 } })),
    })
    series.push({ name: 'DIF', type: 'line', data: macd.dif || [], xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: C.primary } })
    series.push({ name: 'DEA', type: 'line', data: macd.dea || [], xAxisIndex: 2, yAxisIndex: 2, showSymbol: false, lineStyle: { width: 1, color: C.accent } })

    return {
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: C.primary } },
      grid: [
        { left: 46, right: 12, top: 28, height: '44%' },
        { left: 46, right: 12, top: '56%', height: '13%' },
        { left: 46, right: 12, top: '73%', height: '13%' },
      ],
      xAxis: [0, 1, 2].map(i => ({
        type: 'category', data: dates, gridIndex: i, boundaryGap: true,
        axisLine: { lineStyle: { color: '#ddd' } }, axisLabel: { show: i === 2, fontSize: 9, color: '#999' },
        axisTick: { show: false }, splitLine: { show: false },
      })),
      yAxis: [
        { type: 'value', gridIndex: 0, scale: true, axisLabel: { fontSize: 9, color: '#999' }, splitLine: { lineStyle: { color: C.grid } } },
        { type: 'value', gridIndex: 1, scale: true, splitNumber: 2, axisLabel: { show: false }, splitLine: { show: false } },
        { type: 'value', gridIndex: 2, scale: true, splitNumber: 2, axisLabel: { fontSize: 9, color: '#999' }, splitLine: { show: false } },
      ],
      legend: {
        top: 2, left: 0, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 9, color: C.text },
        data: series.map(s => s.name).filter(n => n && !['成交量', 'MACD'].includes(n)),
      },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross' }, confine: true, backgroundColor: 'rgba(255,255,255,0.96)', borderColor: C.tag,
        textStyle: { fontSize: 11, color: '#333' },
        formatter: (params) => {
          const idx = params?.[0]?.dataIndex
          if (idx == null || !bars[idx]) return ''
          const b = bars[idx]
          const rows = [
            `<div style="font-weight:700">${dates[idx]} ${name} ${symbol}${idx === last && isLive ? ' <span style="color:' + C.primary + '">未收盘</span>' : ''}</div>`,
            `开 ${fmt(b[0])}　收 ${fmt(b[1])}　低 ${fmt(b[2])}　高 ${fmt(b[3])}`,
            `涨幅 ${fmt(b[7], 2)}%　换手 ${fmt(b[6], 2)}%`,
            `成交量 ${b[4] == null ? '—' : Number(b[4]).toLocaleString()} 手　成交额 ${b[5] == null ? '—' : fmt(Number(b[5]) / 1e8)} 亿`,
          ]
          if (idx === last && isLive && kline.vol_scale) rows.push(`<span style="color:${C.primary}">折算全天量 ≈ ${Math.round((b[4] || 0) / kline.vol_scale).toLocaleString()} 手（×${fmt(1 / kline.vol_scale, 2)}）</span>`)
          Object.keys(kline.ma || {}).forEach(key => {
            const v = kline.ma[key]?.[idx]
            if (v != null) rows.push(`${key.toUpperCase()} ${fmt(v)}`)
          })
          const macdBar = (macd.bar || [])[idx]
          if (macdBar != null) rows.push(`MACD ${fmt(macdBar, 3)}　DIF ${fmt((macd.dif || [])[idx], 3)}　DEA ${fmt((macd.dea || [])[idx], 3)}`)
          const fails = failMarks.find(f => f.date === dates[idx])
          if (fails) rows.push(`<span style="color:${C.accent}">未达标：${fails.text.replace(/\n/g, '、')}</span>`)
          const reds = redMarks.find(r => r.date === dates[idx])
          if (reds) rows.push(`<span style="color:${C.up};font-weight:700">红线：${reds.text.replace(/\n/g, '、')}</span>`)
          return rows.join('<br/>')
        },
      },
      dataZoom: [
        { type: 'inside', xAxisIndex: [0, 1, 2], start: Math.max(0, 100 - Math.round(12000 / dates.length)), end: 100 },
        { type: 'slider', xAxisIndex: [0, 1, 2], height: 14, bottom: 4, start: Math.max(0, 100 - Math.round(12000 / dates.length)), end: 100, borderColor: C.tag, fillerColor: 'rgba(139,58,66,0.10)', textStyle: { fontSize: 8 } },
      ],
      series,
    }
  }, [kline, show, name, symbol])

  if (!kline || !Array.isArray(kline.bars) || !kline.bars.length) {
    return <div style={{ padding: '30px 0', textAlign: 'center', color: '#999', fontSize: 12 }}>本次运行未取到该票日线数据</div>
  }

  const panel = kline.panel || {}
  const statChips = [
    { label: '道氏', value: { UP: '上升', DOWN: '下降', SHAKE: '震荡' }[panel.dow?.trend || panel.dow] || '—' },
    { label: 'ADX', value: `${fmt(panel.adx, 1)}（+${fmt(panel.pdi, 1)}/-${fmt(panel.mdi, 1)}）` },
    { label: '现价', value: fmt(panel.price) },
    { label: 'MA20', value: fmt(panel.ma_mid) },
    { label: '量比(折算)', value: `${fmt(panel.vol_ratio_est)}倍` },
    { label: '量比(原始)', value: `${fmt(panel.vol_ratio_raw)}倍` },
    { label: '60日回撤', value: `${fmt(panel.retrace_pct, 1)}%` },
    { label: '距60日低', value: `${fmt(panel.dist_to_low_pct, 1)}%` },
    { label: 'fib支撑', value: panel.fib?.near ? `${panel.fib.near.replace('fib', '')} ${fmt(panel.fib[panel.fib.near])}` : '未靠近' },
  ]

  return (
    <div>
      {/* 标注开关 */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
        {Object.entries(OVERLAY_LABELS).map(([code, label]) => (
          <span
            key={code}
            onClick={() => setShow(prev => ({ ...prev, [code]: !prev[code] }))}
            style={{
              fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
              background: show[code] ? C.tag : '#f5f5f5',
              color: show[code] ? C.primary : '#999',
              border: `1px solid ${show[code] ? C.accent : '#eee'}`,
            }}
          >
            {label}{overlays.includes(code) ? '' : '（本次不适用）'}
          </span>
        ))}
      </div>

      <ReactEChartsCore
        echarts={echarts}
        option={option}
        notMerge
        lazyUpdate
        style={{ height: 430, width: '100%' }}
      />

      {/* 指标数值面板 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 8px', marginTop: 6, background: C.light, borderRadius: 8, padding: 8 }}>
        {statChips.map(s => (
          <div key={s.label} style={{ fontSize: 10, color: C.text, lineHeight: 1.5 }}>
            <span style={{ color: '#999' }}>{s.label} </span>
            <strong style={{ color: C.primary }}>{s.value}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
