/**
 * 胡胖胖招财进宝 —— 判定项配置
 *
 * 改每项权重、开关、子项分值；新增自定义判定项；恢复出厂重播种。
 * 保存即 PUT /fortune/criteria，成功后回传最新 doc 让主页面刷新。
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

export default function CriteriaConfig({ visible, onClose, doc, onSaved }) {
  const [list, setList] = useState([])
  const [saving, setSaving] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')

  useEffect(() => { if (doc) setList((doc.criteria || []).map(c => ({ ...c, items: (c.items || []).map(x => ({ ...x })) }))) }, [doc, visible])

  const patch = (code, kv) => setList(prev => prev.map(c => (c.code === code ? { ...c, ...kv } : c)))
  const patchItem = (code, id, kv) => setList(prev => prev.map(c => (
    c.code === code ? { ...c, items: (c.items || []).map(it => (it.id === id ? { ...it, ...kv } : it)) } : c
  )))

  const addCriterion = () => {
    const code = newCode.trim()
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(code)) return Toast.show({ content: '编码用小写字母开头，2-31 位（如 volume）' })
    if (list.some(c => c.code === code)) return Toast.show({ content: '该编码已存在' })
    setList(prev => [...prev, { code, name: newName.trim() || code, type: 'manual', weight: 0, enabled: true, items: [], description: '自定义判定项' }])
    setNewCode(''); setNewName('')
    Toast.show({ content: '已添加，记得设置权重并保存' })
  }

  const save = async () => {
    const sum = list.filter(c => c.enabled).reduce((s, c) => s + Number(c.weight || 0), 0)
    if (Math.abs(sum - 100) > 0.01 && !window.confirm(`启用项权重之和为 ${sum}%（不等于 100）。仍要保存吗？`)) return
    setSaving(true)
    try {
      const res = await fortuneApi.updateCriteria(list.map(c => ({
        code: c.code, name: c.name, type: c.type, weight: Number(c.weight) || 0, enabled: !!c.enabled,
        items: c.items.map(it => ({ ...it, points: Number(it.points) || 0 })),
      })))
      if (res.ok) { Toast.show({ content: '已保存判定项' }); onSaved && onSaved(res.doc) }
      else Toast.show({ content: res.error || '保存失败' })
    } catch (e) {
      Toast.show({ content: `保存失败：${e.message}` })
    } finally { setSaving(false) }
  }

  const reset = async () => {
    if (!window.confirm('恢复出厂会用配置文件覆盖全部判定项（人工新增的项会被停用但保留），确定？')) return
    const res = await fortuneApi.resetCriteria()
    if (res.ok) { Toast.show({ content: '已恢复出厂并重新播种' }); onSaved && onSaved(res.doc) }
  }

  const enabledSum = list.filter(c => c.enabled).reduce((s, c) => s + Number(c.weight || 0), 0)

  return (
    <Popup visible={visible} onMaskClick={onClose} bodyStyle={{ height: '86vh', borderTopLeftRadius: 14, borderTopRightRadius: 14, background: C.light }} showCloseButton={false}>
      <PopupHeader title="判定项与权重配置" onClose={onClose} />
      <div style={{ padding: 12, overflow: 'auto', height: 'calc(86vh - 108px)' }}>
        <div style={{ fontSize: 11, color: '#999', marginBottom: 8, lineHeight: 1.5 }}>
          {doc?.formula || '总分 = Σ(判定项得分[0-100] × 权重%)'}
          <div style={{ marginTop: 4 }}>当前启用项权重之和：<strong style={{ color: Math.abs(enabledSum - 100) < 0.01 ? C.primary : '#e6b422' }}>{fmt(enabledSum, 0)}%</strong></div>
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
