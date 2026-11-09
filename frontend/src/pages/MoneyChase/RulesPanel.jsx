/**
 * 每日追资金 —— 规则与参数总表（页面全文展示 + 就地修改）
 *
 * 真源关系（与后端约定一致）：
 *   backend/config/money_chase_rules.json →（启动/手动播种）→ money_chase_rules 表 → 本组件渲染
 *   页面改过的项 is_custom=true，播种时只更新文案、不覆盖数值；脚本永远只读「表里拍平后的生效参数」
 *   ⇒ 改文档、或改页面，两种改法都能让代码生效
 */
import React, { useMemo, useState } from 'react'
import { Button, Dialog, Input, Switch, Tag, Toast } from 'antd-mobile'
import { moneyChaseApi } from '../../services/api'

const C = {
  primary: '#8B3A42',
  accent: '#C4737A',
  tag: '#F5E6E8',
  light: '#FAF0F1',
  danger: '#e74c3c',
  text: '#666',
}

const MODE_TAG = {
  auto: { text: '自动判定', color: C.primary },
  semi: { text: '自动预警+人工确认', color: C.accent },
  manual: { text: '纯人工', color: '#999' },
}

/** 参数输入控件类型推断（按出厂值形态） */
function widgetType(row) {
  const raw = row.value != null ? row.value : row.defaultValue
  if (raw === 'true' || raw === 'false') return 'bool'
  if (row.payload?.options?.length) return 'options'
  if (raw != null && /^-?\d+(\.\d+)?$/.test(String(raw))) return 'number'
  return 'text'
}

function Section({ title, subtitle, children, danger }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 6, borderBottom: `2px solid ${danger ? C.tag : '#eee'}`, paddingBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: danger ? C.primary : '#333' }}>{title}</span>
        {subtitle && <span style={{ fontSize: 10, color: '#999' }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function Row({ row, draft, onPatch, onReset, index }) {
  const view = { ...row, ...(draft || {}) }
  const type = widgetType(row)
  const dirty = !!draft
  const isScoreLike = ['score', 'manual'].includes(row.category)

  return (
    <div style={{
      background: dirty ? C.light : '#fff', border: `1px solid ${dirty ? C.accent : '#eee'}`,
      borderLeft: `3px solid ${row.category === 'redline' ? (row.enabled === false || view.enabled === false ? '#ddd' : C.danger) : (dirty ? C.accent : '#eee')}`,
      borderRadius: 8, padding: '8px 10px', marginBottom: 6,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#333', lineHeight: 1.45 }}>
            <span style={{ color: C.accent, marginRight: 4 }}>{row.code || `${index + 1}`}</span>
            {row.label}
          </div>
          {row.description && (
            <div style={{ fontSize: 10, color: C.text, lineHeight: 1.55, marginTop: 3, whiteSpace: 'pre-wrap' }}>
              {row.description}
              {row.payload?.formula ? <span style={{ color: C.primary }}>　公式：{row.payload.formula}</span> : null}
              {row.payload?.reason ? <span style={{ color: '#999' }}>　原因：{row.payload.reason}</span> : null}
            </div>
          )}
        </div>

        {/* 右侧编辑区 */}
        <div style={{ width: 118, flexShrink: 0, textAlign: 'right' }}>
          {row.category === 'param' && type === 'bool' && (
            <Switch
              checked={view.value === 'true' || view.enabled === true}
              onChange={v => onPatch(row.key, { value: String(v) })}
              style={{ '--height': '20px', '--width': '44px' }}
            />
          )}
          {row.category === 'param' && type !== 'bool' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
              <Input
                value={view.value ?? ''}
                onChange={v => onPatch(row.key, { value: v })}
                type={type === 'number' ? 'number' : 'text'}
                style={{ '--font-size': '12px' }}
              />
              <span style={{ fontSize: 10, color: '#999' }}>{row.unit}</span>
            </div>
          )}
          {row.category !== 'param' && (
            <Switch
              checked={view.enabled !== false}
              onChange={v => onPatch(row.key, { enabled: v })}
              style={{ '--height': '20px', '--width': '44px' }}
            />
          )}
          {isScoreLike && (
            <div style={{ fontSize: 10, color: '#999', marginTop: 4 }}>
              分值
              <span
                onClick={() => onPatch(row.key, { points: Math.max(0, (Number(view.points) || 0) - 1) })}
                style={{ padding: '0 6px', marginLeft: 4, background: '#f5f5f5', borderRadius: 4, color: C.primary, cursor: 'pointer' }}
              >−</span>
              <strong style={{ padding: '0 6px' }}>{Number(view.points) || 0}</strong>
              <span
                onClick={() => onPatch(row.key, { points: (Number(view.points) || 0) + 1 })}
                style={{ padding: '0 6px', background: '#f5f5f5', borderRadius: 4, color: C.primary, cursor: 'pointer' }}
              >＋</span>
            </div>
          )}
          {row.mode && MODE_TAG[row.mode] && (
            <Tag style={{ '--background': C.tag, '--color': MODE_TAG[row.mode].color, fontSize: 9, marginTop: 4 }} fill="outline">
              {MODE_TAG[row.mode].text}
            </Tag>
          )}
          {row.category === 'param' && (
            <div style={{ fontSize: 9, color: '#bbb', marginTop: 3 }}>
              出厂 {row.defaultValue}
              {row.isCustom ? <span style={{ color: C.primary }}>　·已人工改过</span> : null}
              {row.isCustom && <span onClick={() => onReset(row.key)} style={{ color: C.accent, marginLeft: 4, cursor: 'pointer' }}>恢复默认</span>}
            </div>
          )}
        </div>
      </div>

      {type === 'options' && row.category === 'param' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          {row.payload.options.map(opt => (
            <span
              key={opt}
              onClick={() => onPatch(row.key, { value: opt })}
              style={{
                fontSize: 10, padding: '2px 8px', borderRadius: 10, cursor: 'pointer',
                background: String(view.value) === opt ? C.tag : '#f5f5f5',
                color: String(view.value) === opt ? C.primary : '#999',
              }}
            >{opt}</span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RulesPanel({ rules, onChanged }) {
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState(false)

  const rows = rules?.flat || []
  const dirtyCount = Object.keys(drafts).length

  const byCategory = useMemo(() => {
    const map = {}
    for (const r of rows) {
      if (!map[r.category]) map[r.category] = []
      map[r.category].push(r)
    }
    return map
  }, [rows])

  const patch = (key, data) => setDrafts(prev => ({ ...prev, [key]: { ...(prev[key] || {}), ...data } }))

  const handleSave = async () => {
    const items = Object.entries(drafts).map(([key, d]) => ({ key, ...d }))
    if (!items.length) return
    setSaving(true)
    try {
      const res = await moneyChaseApi.updateRules(items)
      if (res.ok) {
        Toast.show({ content: `已保存 ${res.count} 项，下次运行即生效`, icon: 'success' })
        setDrafts({})
        onChanged && onChanged()
      } else {
        Toast.show({ content: res.error || '保存失败', icon: 'fail' })
      }
    } catch {
      Toast.show({ content: '保存请求失败', icon: 'fail' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetOne = async (key) => {
    const res = await moneyChaseApi.resetRule(key)
    if (res.ok) { Toast.show({ content: '已恢复出厂值', icon: 'success' }); onChanged && onChanged() }
  }

  const handleReseed = () => {
    Dialog.confirm({
      content: '将按 backend/config/money_chase_rules.json 重新同步规则文本与出厂值。你在页面上改过的数值不会被覆盖，确定吗？',
      confirmText: '重新同步',
      onConfirm: async () => {
        const res = await moneyChaseApi.reseedRules()
        if (res.ok) {
          Toast.show({ content: `同步完成：新增 ${res.data.inserted}，更新 ${res.data.updated}`, icon: 'success' })
          onChanged && onChanged()
        } else {
          Toast.show({ content: res.error || '同步失败', icon: 'fail' })
        }
      },
    })
  }

  const versionMismatch = rules && rules.fileVersion && rules.dbVersion && rules.fileVersion !== rules.dbVersion

  const renderGrouped = (list, titleFn, danger = false) => {
    const groups = {}
    for (const r of list) {
      const t = titleFn(r)
      if (!groups[t]) groups[t] = []
      groups[t].push(r)
    }
    return Object.entries(groups).map(([title, items]) => (
      <Section key={title} title={title} subtitle={`${items.length} 项`} danger={danger}>
        {items.map((r, i) => (
          <Row key={r.key} row={r} index={i} draft={drafts[r.key]} onPatch={patch} onReset={handleResetOne} />
        ))}
      </Section>
    ))
  }

  return (
    <div style={{ padding: '0 2px' }}>
      {/* 真源说明 */}
      <div style={{ background: C.light, borderRadius: 10, padding: 10, marginBottom: 10, fontSize: 11, color: C.text, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 700, color: C.primary, marginBottom: 4 }}>规则唯一来源（改这里也能改行为）</div>
        <div>文件：backend/config/money_chase_rules.json　版本 v{rules?.fileVersion || '?'}</div>
        <div>数据库 v{rules?.dbVersion || '?'}{versionMismatch ? '　⚠️ 文件版本比数据库新，点「重新同步」' : ''}</div>
        <div style={{ marginTop: 4 }}>{(byCategory.text || []).find(r => r.key === 'text:notice')?.description}</div>
        <div style={{ marginTop: 6 }}>
          <Button size="mini" color="default" fill="outline" onClick={handleReseed}>从文件重新同步</Button>
        </div>
      </div>

      {/* 总则文本 */}
      {(byCategory.text || []).map(r => (
        <Section key={r.key} title={r.label}>
          <div style={{ background: '#fff', border: '1px solid #eee', borderRadius: 8, padding: '8px 10px', fontSize: 11, color: C.text, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
            {r.description}
          </div>
        </Section>
      ))}

      {/* 池子定义 */}
      {(byCategory.pool || []).length > 0 && (
        <Section title="两个池子（准入与持仓规则）">
          {(byCategory.pool || []).map((r, i) => (
            <Row key={r.key} row={r} index={i} draft={drafts[r.key]} onPatch={patch} onReset={handleResetOne} />
          ))}
        </Section>
      )}

      {/* 红线（最高优先级展示） */}
      {renderGrouped(byCategory.redline || [], r => r.group_name, true)}

      {/* 打分项 */}
      {renderGrouped(byCategory.score || [], r => r.group_name)}

      {/* 人工复核项 */}
      {renderGrouped(byCategory.manual || [], r => r.group_name)}

      {/* K 线标注 */}
      {(byCategory.overlay || []).length > 0 && (
        <Section title="K 线图标注内容" subtitle="图上会画出来的东西">
          {(byCategory.overlay || []).map((r, i) => (
            <div key={r.key} style={{ fontSize: 11, color: C.text, lineHeight: 1.6, marginBottom: 6 }}>
              <strong style={{ color: C.primary }}>{r.label}</strong>
              <span style={{ color: '#999' }}>（{r.pool === 'AB' ? 'A/B 通用' : `${r.pool} 池`}）</span>
              <div>{r.description}</div>
            </div>
          ))}
        </Section>
      )}

      {/* 可调参数 */}
      {renderGrouped(byCategory.param || [], r => `${r.group_name || '参数'}`)}

      {/* 保存条 */}
      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: `1px solid ${C.tag}`, padding: '8px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ flex: 1, fontSize: 11, color: dirtyCount ? C.primary : '#999' }}>
          {dirtyCount ? `已修改 ${dirtyCount} 项，保存后下次运行生效（无需重启服务）` : '本页所有数值都可改；改完点保存'}
        </span>
        {dirtyCount > 0 && <Button size="small" fill="none" onClick={() => setDrafts({})}>放弃修改</Button>}
        <Button size="small" color="primary" disabled={!dirtyCount} loading={saving} onClick={handleSave}>保存修改</Button>
      </div>
    </div>
  )
}
