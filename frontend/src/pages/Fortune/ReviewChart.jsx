/**
 * 胡胖胖招财进宝 —— K 线复盘图
 *
 * 行情复用「每日追资金」的单票分析接口（新浪日线，后端有缓存），只取其中的 kline 字段画图。
 * 关键点：asOfDate 把 K 线截断到评估那天（含当天），末根就是"当时看到的位置"，方便复盘当初判断对不对。
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Button, Toast } from 'antd-mobile'
import { moneyChaseApi } from '../../services/api'
import KlineChart from '../MoneyChase/KlineChart'
import { C, trimKline } from './helpers'

export default function ReviewChart({ symbol, name = '', sector = '', asOfDate = '' }) {
  const [raw, setRaw] = useState(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState(null)

  const load = async (force = false) => {
    if (!/^\d{6}$/.test(String(symbol || ''))) { setErr('请输入 6 位股票代码后再看图'); return }
    setLoading(true); setErr(null)
    try {
      const res = await moneyChaseApi.getStockAnalysis(symbol, sector, force)
      if (!res.ok) { setErr(res.error || '行情拉取失败'); setRaw(null); return }
      const kl = res.data?.stock?.kline || null
      if (!kl || !kl.bars?.length) { setErr('未取到日线数据（可能代码不存在或长期停牌）'); setRaw(null); return }
      setRaw(kl)
    } catch (e) {
      setErr(`行情拉取异常：${e.message}`); setRaw(null)
    } finally { setLoading(false) }
  }

  useEffect(() => { setRaw(null); setErr(null) }, [symbol])

  const shown = useMemo(() => (raw ? trimKline(raw, asOfDate) : null), [raw, asOfDate])
  const lastDate = shown?.dates?.[shown.dates.length - 1]

  return (
    <div style={{ background: '#fff', border: `1px solid ${C.tag}`, borderRadius: 10, padding: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.primary }}>K 线复盘</span>
        {asOfDate && <span style={{ fontSize: 10, color: C.accent }}>截到 {asOfDate}{lastDate ? `（末根到 ${lastDate}）` : ''}</span>}
        <div style={{ flex: 1 }} />
        <Button size="mini" fill="outline" loading={loading}
          style={{ '--border-color': C.accent, '--text-color': C.accent }}
          onClick={() => load(false)}>{raw ? '取数' : '加载K线'}</Button>
        {raw && <Button size="mini" fill="none" style={{ '--text-color': '#999' }} onClick={() => { load(true); Toast.show({ content: '已强制重新拉取' }) }}>刷新</Button>}
      </div>

      {loading && <div style={{ padding: 30, textAlign: 'center', color: '#999', fontSize: 12 }}>正在拉取日线…</div>}
      {err && !loading && <div style={{ padding: 20, textAlign: 'center', color: C.accent, fontSize: 12 }}>{err}</div>}
      {!loading && !err && !shown && <div style={{ padding: 20, textAlign: 'center', color: '#bbb', fontSize: 12 }}>点「加载K线」查看日 K 与均线/量能标注</div>}
      {!loading && shown && (
        <>
          <KlineChart kline={shown} name={name} symbol={symbol} />
          <div style={{ fontSize: 10, color: '#999', marginTop: 6, lineHeight: 1.5 }}>
            提示：切换上方「评估日期」即可把图截断到那一天，对照当时的 K 线复查这套打分是否合理。数据来自追资金行情接口（新浪日线）。
          </div>
        </>
      )}
    </div>
  )
}
