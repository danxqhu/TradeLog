/**
 * 每日追资金 —— 今日分时图（ECharts 折线 + 量能柱）
 *
 * 数据来源：fetch_money_chase.py 的 sina_minutes()（新浪 1 分钟线，1 次请求、不重试）
 *   minutes  [{t:'09:31', p:现价, v:该分钟量(手), avg:累计均价, pct:相对昨收涨幅%}]
 *   minutes_period_min 分时周期（1 分钟；新浪 1 分钟取不到时回落 5 分钟）
 *   minutes_date        分时所属交易日（非交易日/停牌时是最近一个有数据的交易日，页面会标清）
 *   prev_close          昨收（画基准线 + 上下区域着色）
 *
 * 后端接口有缓存（盘中 60 秒、收盘后 10 分钟），刷新页面不会反复打新浪接口。
 */
import React, { useMemo } from 'react'
import ReactEChartsCore from 'echarts-for-react/esm/core'
import * as echarts from 'echarts/core'
import { LineChart, BarChart } from 'echarts/charts'
import {
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  MarkLineComponent, MarkAreaComponent, AxisPointerComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart, BarChart,
  GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  MarkLineComponent, MarkAreaComponent, AxisPointerComponent,
  CanvasRenderer,
])

const C = {
  up: '#e74c3c', down: '#27ae60', primary: '#8B3A42', accent: '#C4737A',
  light: '#FAF0F1', tag: '#F5E6E8', grid: '#eee', text: '#666',
}

const fmt = (v, n = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(n))

export default function MinuteChart({ points = [], prevClose = null, periodMin = 1, minutesDate = '', name = '', symbol = '' }) {
  const option = useMemo(() => {
    if (!Array.isArray(points) || points.length < 2) return null
    const times = points.map(x => x.t)
    const prices = points.map(x => x.p)
    const avgs = points.map(x => x.avg)
    const vols = points.map(x => x.v)
    const base = Number(prevClose) || prices[0]
    // 午间休市：在 11:30 与 13:00 之间断开，避免一条直线跨过午休
    const lunchIdx = times.findIndex(t => t >= '13:00')
    const cut = lunchIdx > 0 && times[lunchIdx - 1] <= '11:30'

    const priceSeries = (data, nm, color, width, extra = {}) => ({
      name: nm, type: 'line', data, xAxisIndex: 0, yAxisIndex: 0,
      showSymbol: false, smooth: false, connectNulls: false,
      lineStyle: { width, color }, ...extra,
    })

    return {
      animation: false,
      axisPointer: { link: [{ xAxisIndex: 'all' }], label: { backgroundColor: C.primary } },
      grid: [
        { left: 48, right: 46, top: 26, height: '52%' },
        { left: 48, right: 46, top: '76%', height: '16%' },
      ],
      xAxis: [0, 1].map(i => ({
        type: 'category', data: times, gridIndex: i, boundaryGap: i === 1,
        axisLine: { lineStyle: { color: '#ddd' } },
        axisLabel: { show: true, fontSize: 9, color: '#999', interval: Math.max(1, Math.round(times.length / 6)) },
        axisTick: { show: false }, splitLine: { show: false },
      })),
      yAxis: [
        // 左轴价格、右轴涨幅%（都以昨收为零点/基准）
        {
          type: 'value', gridIndex: 0, scale: false,
          axisLabel: { fontSize: 9, color: '#999', formatter: v => fmt(v, 2) },
          splitLine: { lineStyle: { color: C.grid } },
        },
        {
          type: 'value', gridIndex: 0, position: 'right', splitNumber: 4,
          axisLabel: { fontSize: 9, color: '#999', formatter: v => `${v > 0 ? '+' : ''}${fmt(v, 1)}%` },
          splitLine: { show: false }, axisLine: { show: false }, axisTick: { show: false },
        },
        { type: 'value', gridIndex: 1, scale: true, splitNumber: 2, axisLabel: { show: false }, splitLine: { show: false } },
      ],
      legend: { top: 2, left: 0, itemWidth: 10, itemHeight: 8, textStyle: { fontSize: 9, color: C.text }, data: ['价格', '均价', '成交量'] },
      tooltip: {
        trigger: 'axis', axisPointer: { type: 'cross' }, confine: true,
        backgroundColor: 'rgba(255,255,255,0.96)', borderColor: C.tag, textStyle: { fontSize: 11, color: '#333' },
        formatter: (params) => {
          const idx = params?.[0]?.dataIndex
          if (idx == null || !points[idx]) return ''
          const x = points[idx]
          const rows = [
            `<div style="font-weight:700">${minutesDate || ''} ${x.t}　${name} ${symbol}</div>`,
            `价格 ${fmt(x.p)}　均价 ${fmt(x.avg)}`,
            `涨幅 <span style="color:${(x.pct || 0) > 0 ? C.up : (x.pct || 0) < 0 ? C.down : '#999'}">${x.pct == null ? '—' : `${x.pct > 0 ? '+' : ''}${fmt(x.pct)}%`}</span>　较昨收 ${fmt((x.p || 0) - base)}`,
            `这一分钟 ${x.v == null ? '—' : Number(x.v).toLocaleString()} 手`,
          ]
          return rows.join('<br/>')
        },
      },
      series: [
        // 涨幅%轴上的价格线（右轴）：与左轴同一份数据，只是让 axisPointer 能读到百分比刻度（不进图例）
        {
          ...priceSeries(points.map(x => x.pct), '涨幅线', 'transparent', 0),
          yAxisIndex: 1, tooltip: { show: false },
        },
        {
          ...priceSeries(prices, '价格', C.primary, 1.4, {
            areaStyle: { color: C.light, opacity: 0.6 },
            markLine: {
              symbol: 'none', silent: true, animation: false,
              data: [
                { yAxis: base, lineStyle: { color: '#999', type: 'dashed', width: 1 }, label: { show: true, position: 'insideStartTop', formatter: `昨收 ${fmt(base)}`, fontSize: 9, color: '#999' } },
                ...(cut ? [{ xAxis: times[lunchIdx], lineStyle: { color: '#ddd', type: 'dotted' }, label: { show: false } }] : []),
              ],
            },
            markArea: {
              silent: true, animation: false,
              data: [
                [{ yAxis: base, itemStyle: { color: 'rgba(231,76,60,0.05)' } }, { yAxis: Math.max(...prices) * 1.001 }],
                [{ yAxis: Math.min(...prices) * 0.999, itemStyle: { color: 'rgba(39,174,96,0.05)' } }, { yAxis: base }],
              ],
            },
          }),
        },
        priceSeries(avgs, '均价', C.accent, 1.2),
        {
          name: '成交量', type: 'bar', xAxisIndex: 1, yAxisIndex: 2, barWidth: '62%',
          data: vols.map((v, i) => ({
            value: v,
            itemStyle: { color: (prices[i] >= (i ? prices[i - 1] : base) ? C.up : C.down), opacity: 0.7 },
          })),
        },
      ],
    }
  }, [points, prevClose, name, symbol, minutesDate])

  if (!Array.isArray(points) || points.length < 2) {
    return (
      <div style={{ padding: '26px 0', textAlign: 'center', color: '#999', fontSize: 12, lineHeight: 1.8 }}>
        没有取到今日分时（新浪 1 分钟线只请求 1 次，不重试）。<br />
        停牌、退市、代码有误，或接口本次限流时会出现这种情况，可点上方「强制刷新」再试一次。
      </div>
    )
  }

  const lastPct = points[points.length - 1].pct
  const head = (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 11, color: C.text, marginBottom: 4, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 18, fontWeight: 700, color: (lastPct || 0) > 0 ? C.up : (lastPct || 0) < 0 ? C.down : '#999' }}>
        {fmt(points[points.length - 1].p)}
      </span>
      <span style={{ color: (lastPct || 0) > 0 ? C.up : (lastPct || 0) < 0 ? C.down : '#999', fontWeight: 600 }}>
        {lastPct == null ? '—' : `${lastPct > 0 ? '+' : ''}${fmt(lastPct)}%`}
      </span>
      <span style={{ color: '#999' }}>昨收 {fmt(prevClose)}　分时 {points.length} 点 · {periodMin} 分钟粒度</span>
    </div>
  )

  return (
    <div>
      {head}
      <ReactEChartsCore echarts={echarts} option={option} notMerge lazyUpdate style={{ height: 300, width: '100%' }} />
      <div style={{ fontSize: 10, color: '#bbb', marginTop: 4, lineHeight: 1.6 }}>
        分时口径：新浪 {periodMin} 分钟 K 线合成的分时走势与累计均价，分时日期 {minutesDate || '—'}（非交易日会退回最近一个有数据的交易日）。
      </div>
    </div>
  )
}
