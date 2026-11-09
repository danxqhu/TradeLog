/**
 * 每日追资金 —— 定时节点配置（可配多个时间点，保存后热注册 cron，无需重启服务）
 *
 * 后端约定：本节所有增删改都会调用 reloadMoneyChaseSchedules() 重建 node-cron；
 * 表达式固定「秒 :05 + 周一至周五」，是否交易日再由 isTradingDay 精确过滤（节假日跳过）。
 * 失败不重试、不补跑，原因写进批次记录，页面批次列表可见。
 */
import React, { useEffect, useState } from 'react'
import { Button, Dialog, Input, Stepper, Switch, Toast } from 'antd-mobile'
import { moneyChaseApi } from '../../services/api'

const C = { primary: '#8B3A42', accent: '#C4737A', tag: '#F5E6E8', light: '#FAF0F1', text: '#666' }

const STATUS_TEXT = { completed: '成功', partial: '部分成功', failed: '失败', running: '运行中', pending: '待运行' }

function emptyDraft() {
  return { time_hm: '', label: '', sector_source: 'auto_top', top_n: 3, fixed_sectors: [], enabled: true, trading_day_only: true }
}

// 独立定义（不能写在组件函数体内：否则每次输入都会整块重挂载，Input 会失焦）
function RowCard({ row, isNew, update, onSave, onRemove, onTrigger, busy }) {
  return (
    <div style={{
      background: isNew ? C.light : '#fff', border: `1px solid ${isNew ? C.accent : '#eee'}`,
      borderRadius: 10, padding: 10, marginBottom: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 82 }}>
          <Input
            value={row.time_hm || ''}
            onChange={v => update(row, { time_hm: v })}
            placeholder="HH:MM"
            style={{ '--font-size': '14px', fontWeight: 700, background: '#fff', padding: '2px 6px', borderRadius: 6, border: '1px solid #eee' }}
          />
        </div>
        <div style={{ flex: 1 }}>
          <Input
            value={row.label || ''}
            onChange={v => update(row, { label: v })}
            placeholder="节点备注（如：买点窗口前定档）"
            style={{ '--font-size': '12px' }}
          />
        </div>
        <Switch
          checked={row.enabled !== false}
          onChange={v => update(row, { enabled: v })}
          style={{ '--height': '20px', '--width': '44px' }}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.text }}>板块来源</span>
        {['auto_top', 'fixed'].map(opt => (
          <span
            key={opt}
            onClick={() => update(row, { sector_source: opt })}
            style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
              background: row.sector_source === opt ? C.tag : '#f5f5f5',
              color: row.sector_source === opt ? C.primary : '#999',
            }}
          >
            {opt === 'auto_top' ? '自动取资金流入 TopN' : '固定板块清单'}
          </span>
        ))}
        <span style={{ fontSize: 11, color: C.text }}>{row.sector_source === 'fixed' ? '板块（逗号分隔）' : 'TopN'}</span>
        {row.sector_source === 'fixed' ? (
          <div style={{ width: 140 }}>
            <Input
              value={(row.fixed_sectors || []).join(',')}
              onChange={v => update(row, { fixed_sectors: v.split(/[,，]/).map(s => s.trim()).filter(Boolean) })}
              placeholder="机器人,军工"
              style={{ '--font-size': '11px', background: '#fff', padding: '2px 6px', borderRadius: 6, border: '1px solid #eee' }}
            />
          </div>
        ) : (
          <Stepper
            value={Number(row.top_n) || 3} min={1} max={10}
            onChange={v => update(row, { top_n: v })}
            style={{ '--button-width': '22px', '--input-width': '34px', '--height': '26px', fontSize: 11 }}
          />
        )}
        <label style={{ fontSize: 11, color: C.text, display: 'flex', alignItems: 'center', gap: 4 }}>
          仅交易日
          <Switch
            checked={row.trading_day_only !== false}
            onChange={v => update(row, { trading_day_only: v })}
            style={{ '--height': '18px', '--width': '38px' }}
          />
        </label>
      </div>

      {!isNew ? (
        <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#999' }}>
            上次：{row.last_run_at ? String(row.last_run_at).replace('T', ' ').slice(0, 16) : '尚未运行'}
            {row.last_status ? `　${STATUS_TEXT[row.last_status] || row.last_status}` : ''}
            {row.last_run_id ? `　批次#${row.last_run_id}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button size="mini" fill="outline" color="primary" disabled={busy} onClick={() => onSave(row)}>保存</Button>
            <Button size="mini" fill="outline" disabled={busy} onClick={() => onTrigger(row)}>立即试跑</Button>
            <Button size="mini" fill="none" color="danger" onClick={() => onRemove(row)}>删除</Button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <span style={{ flex: 1, fontSize: 10, color: '#999', alignSelf: 'center' }}>时间格式 HH:MM，24 小时制</span>
          <Button size="mini" fill="none" onClick={onCancel}>取消</Button>
          <Button size="mini" color="primary" disabled={busy || !/^\d{2}:\d{2}$/.test(row.time_hm || '')} onClick={() => onSave(row)}>新增节点</Button>
        </div>
      )}
    </div>
  )
}

export default function SchedulePanel({ onChanged }) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => {
    setLoading(true)
    return moneyChaseApi.getSchedules()
      .then(res => { setList(res.data || []); return res.data || [] })
      .catch(() => Toast.show({ content: '读取定时配置失败', icon: 'fail' }))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const update = (row, data) => {
    if (row.id) setList(prev => prev.map(r => (r.id === row.id ? { ...r, ...data } : r)))
    else setDraft(prev => ({ ...prev, ...data }))
  }

  const save = async (row) => {
    setBusy(true)
    try {
      const body = {
        time_hm: row.time_hm, label: row.label, sector_source: row.sector_source,
        top_n: Number(row.top_n) || 3, fixed_sectors: row.fixed_sectors || [],
        enabled: row.enabled !== false, trading_day_only: row.trading_day_only !== false,
      }
      if (!/^\d{2}:\d{2}$/.test(body.time_hm)) {
        Toast.show({ content: '时间格式应为 HH:MM，例如 09:50', icon: 'fail' })
        return
      }
      const res = row.id ? await moneyChaseApi.updateSchedule(row.id, body) : await moneyChaseApi.createSchedule(body)
      if (res.ok) {
        Toast.show({ content: `${body.time_hm} 已保存并生效（无需重启）`, icon: 'success' })
        setDraft(null)
        await load()
        onChanged && onChanged()
      } else {
        Toast.show({ content: res.error || '保存失败', icon: 'fail' })
      }
    } finally {
      setBusy(false)
    }
  }

  const remove = (row) => {
    Dialog.confirm({
      content: `确定删除 ${row.time_hm} 这个定时节点？删除后到点不再自动筛选。`,
      onConfirm: async () => {
        await moneyChaseApi.deleteSchedule(row.id)
        Toast.show({ content: '已删除', icon: 'success' })
        await load()
        onChanged && onChanged()
      },
    })
  }

  const trigger = async (row) => {
    setBusy(true)
    try {
      const res = await moneyChaseApi.triggerSchedule(row.id)
      if (res.ok) {
        Toast.show({ content: `批次 #${res.data.runId} 已启动，稍后看结果`, icon: 'success' })
        onChanged && onChanged(res.data.runId)
      } else {
        Toast.show({ content: res.error || '启动失败', icon: 'fail' })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ background: C.light, borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, color: C.primary, marginBottom: 2 }}>定时节点怎么跑</div>
        <div>· 到点自动执行：取板块资金流 → 取成分股 → 套用人工加/减清单 → 打分入库</div>
        <div>· 触发时刻固定 <strong>秒 :05</strong>，只认周一至周五；节假日由交易日历自动跳过</div>
        <div>· 接口只调用 1 次，<strong>失败不重试、不补跑</strong>，原因写进批次记录并弹窗提示</div>
        <div>· 保存后立即重建 cron，<strong>无需重启服务</strong>；若上一个批次还在跑，本次会跳过并说明原因</div>
      </div>

      {loading && !list.length ? (
        <div style={{ textAlign: 'center', color: '#999', fontSize: 12, padding: 20 }}>加载中…</div>
      ) : (
        list.map(row => (
          <RowCard key={row.id} row={row} update={update} onSave={save} onRemove={remove} onTrigger={trigger} busy={busy} />
        ))
      )}

      {draft ? (
        <RowCard row={{ ...emptyDraft(), ...draft }} isNew update={update} onSave={save} onCancel={() => setDraft(null)} busy={busy} />
      ) : (
        <Button block size="small" fill="outline" color="primary" onClick={() => setDraft(emptyDraft())}>
          + 新增定时节点
        </Button>
      )}
    </div>
  )
}
