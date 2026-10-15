import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Card, NavBar, Tag, Button, Steps, Toast, Input } from 'antd-mobile'
import { LeftOutline } from 'antd-mobile-icons'
import { positionApi } from '../../services/api'
import dayjs from 'dayjs'

// 酒红色配色常量
const C = {
  primary: '#8B3A42',
  accent: '#C4737A',
  tagBg: '#F5E6E8',
  lightBg: '#FAF0F1',
  track: '#E8CED1',
  gradient: '#C27078',
  success: '#52c41a',
  warning: '#e67e22',
  danger: '#e74c3c',
}

const strategies = {
  rectangle: {
    name: '矩形仓位法',
    description: '资金分成5份，每次加20%，适合无法判断涨跌时等额分批分摊风险',
    direction: 'drop',
    directionLabel: '越跌越买',
    pros: '等额分摊，风险均匀',
    cons: '成本会被推高',
    steps: [
      { step: 1, ratio: 20, trigger: '首次买入', threshold: 0 },
      { step: 2, ratio: 20, trigger: '跌10%', threshold: 10 },
      { step: 3, ratio: 20, trigger: '跌20%', threshold: 20 },
      { step: 4, ratio: 20, trigger: '跌30%', threshold: 30 },
      { step: 5, ratio: 20, trigger: '跌40%', threshold: 40 },
    ],
  },
  pyramid: {
    name: '金字塔仓位法',
    description: '越涨越买，越买越少，首次50%，加仓30%、20%，适合趋势确认后的顺势加仓',
    direction: 'rise',
    directionLabel: '越涨越买',
    pros: '顺势而为，利润最大化',
    cons: '可能追高',
    steps: [
      { step: 1, ratio: 50, trigger: '首次买入', threshold: 0 },
      { step: 2, ratio: 30, trigger: '涨10%', threshold: 10 },
      { step: 3, ratio: 20, trigger: '涨20%', threshold: 20 },
    ],
  },
  funnel: {
    name: '漏斗形仓位法',
    description: '越跌越加，首次10%，逐步加大到30%，左侧交易',
    direction: 'drop',
    directionLabel: '越跌越买',
    pros: '低位多买，摊低成本',
    cons: '可能判断错底部',
    steps: [
      { step: 1, ratio: 10, trigger: '首次买入', threshold: 0 },
      { step: 2, ratio: 15, trigger: '跌10%', threshold: 10 },
      { step: 3, ratio: 20, trigger: '跌20%', threshold: 20 },
      { step: 4, ratio: 25, trigger: '跌30%', threshold: 30 },
      { step: 5, ratio: 30, trigger: '跌40%', threshold: 40 },
    ],
  },
}

export default function PositionStrategy() {
  const { stockCode } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [position, setPosition] = useState(null)
  const [config, setConfig] = useState(null)
  const [addRecords, setAddRecords] = useState([])
  const [stepsWithPrices, setStepsWithPrices] = useState([])
  const [investedAmount, setInvestedAmount] = useState(0)

  const [selectedStrategy, setSelectedStrategy] = useState('')
  const [basePrice, setBasePrice] = useState('')
  const [shares, setShares] = useState('')
  const [alertMin, setAlertMin] = useState('80')
  const [alertMax, setAlertMax] = useState('90')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)

  const [checkResult, setCheckResult] = useState(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => { fetchData() }, [stockCode])

  const fetchData = async () => {
    setLoading(true)
    try {
      const res = await positionApi.getByCode(stockCode)
      const data = res.data
      setPosition(data.position)
      setConfig(data.config)
      setAddRecords(data.add_records || [])
      setStepsWithPrices(data.steps_with_prices || [])
      setInvestedAmount(data.invested_amount || 0)
      if (data.config) {
        setSelectedStrategy(data.config.strategy_type)
        setBasePrice(String(data.config.base_price))
        // 从已保存的 total_capital 反推股数
        if (data.config.total_capital && data.config.base_price) {
          const derivedShares = Math.round(Number(data.config.total_capital) / Number(data.config.base_price))
          setShares(String(derivedShares))
        }
        setAlertMin(String(data.config.alert_threshold_min || 80))
        setAlertMax(String(data.config.alert_threshold_max || 90))
      }
    } catch (error) {
      console.error('获取策略数据失败:', error)
      Toast.show('获取数据失败')
    }
    setLoading(false)
  }

  const handleSaveStrategy = async () => {
    if (!selectedStrategy) { Toast.show('请选择策略'); return }
    if (!basePrice || Number(basePrice) <= 0) { Toast.show('请设置基准价格'); return }
    if (!shares || Number(shares) <= 0) { Toast.show('请设置股数'); return }
    setSaving(true)
    const totalCap = Number(basePrice) * Number(shares)
    try {
      await positionApi.setConfig({
        stock_code: stockCode,
        strategy_type: selectedStrategy,
        base_price: Number(basePrice),
        total_capital: totalCap,
        capital_source: 'manual',
        alert_threshold_min: Number(alertMin) || 80,
        alert_threshold_max: Number(alertMax) || 90,
      })
      Toast.show('策略已保存')
      fetchData()
    } catch (error) {
      console.error('保存策略失败:', error)
      Toast.show(error.response?.data?.error || '保存失败')
    }
    setSaving(false)
  }

  const handleCheckAlert = async () => {
    if (!position?.current_price) { Toast.show('无法获取当前价格'); return }
    setChecking(true)
    setCheckResult(null)
    try {
      const res = await positionApi.checkAlertByCode(stockCode, { current_price: Number(position.current_price) })
      setCheckResult(res.data)
      if (res.data.email_sent) {
        Toast.show(res.data.alert_type === 'trigger' ? '已发送加仓提醒邮件' : '已发送预警邮件')
      } else {
        Toast.show(res.data.message)
      }
    } catch (error) {
      console.error('检查失败:', error)
      Toast.show('检查失败')
    }
    setChecking(false)
  }

  if (loading) {
    return (
      <div className="page-container" style={{ '--adm-color-primary': C.primary }}>
        <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>仓位策略</NavBar>
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>加载中...</div>
      </div>
    )
  }

  if (!position) {
    return (
      <div className="page-container" style={{ '--adm-color-primary': C.primary }}>
        <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>仓位策略</NavBar>
        <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>未找到持仓数据</div>
      </div>
    )
  }

  const pos = position
  const avgCost = Number(pos.avg_cost) || Number(pos.buy_price)
  const currentPrice = Number(pos.current_price) || avgCost
  const isPositive = Number(pos.profit_loss_percent || 0) >= 0

  // 根据实时价格计算已触发的步骤（进度条位置）
  const configBP = config ? Number(config.base_price) : 0
  const configDir = config ? config.strategy_direction : 'drop'
  const changePercent = configBP > 0
    ? ((currentPrice - configBP) / configBP) * 100
    : 0
  const absChange = Math.abs(changePercent)

  // priceReachedIdx: 价格已触达的最高步骤索引
  let priceReachedIdx = 0 // 首次买入始终完成
  if (config && stepsWithPrices.length > 0) {
    for (let i = 1; i < stepsWithPrices.length; i++) {
      const step = stepsWithPrices[i]
      if (configDir === 'drop') {
        // 下跌策略：当前价 <= 触发价 → 已触发
        if (currentPrice <= Number(step.trigger_price)) {
          priceReachedIdx = i
        } else break
      } else {
        // 上涨策略：当前价 >= 触发价 → 已触发
        if (currentPrice >= Number(step.trigger_price)) {
          priceReachedIdx = i
        } else break
      }
    }
  }

  // 进度条位置 = max(价格触发的步骤, 实际加仓记录+1)
  const currentStep = Math.max(priceReachedIdx, addRecords.length + 1)

  return (
    <div className="page-container" style={{ '--adm-color-primary': C.primary }}>
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>
        仓位策略
      </NavBar>

      {/* 股票信息卡片 */}
      <Card style={{ marginTop: 12, borderLeft: `3px solid ${C.primary}` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#333' }}>{pos.stock_name}</span>
            <span style={{ fontSize: 13, color: '#999', marginLeft: 6 }}>{pos.stock_code}</span>
          </div>
          <span style={{ fontSize: 14, fontWeight: 600, color: isPositive ? C.danger : C.success }}>
            {isPositive ? '+' : ''}{pos.profit_loss_percent}%
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px', fontSize: 13, color: '#666' }}>
          <div>成本价: <strong style={{ color: '#333' }}>¥{avgCost}</strong></div>
          <div>现价: <strong style={{ color: '#333' }}>¥{currentPrice}</strong></div>
          <div>持仓: {pos.holding_natural_days}天 / {pos.holding_trading_days}交易日</div>
          <div>盈亏: <span style={{ color: isPositive ? C.danger : C.success }}>{Number(pos.profit_loss) >= 0 ? '+' : ''}{pos.profit_loss}元</span></div>
        </div>
      </Card>

      {/* 策略选择区 */}
      <Card title={<span style={{ color: C.primary }}>选择策略</span>} style={{ marginTop: 12 }}>
        {Object.entries(strategies).map(([key, s]) => (
          <div
            key={key}
            onClick={() => setSelectedStrategy(key)}
            style={{
              padding: '12px 14px',
              background: selectedStrategy === key ? C.lightBg : '#fafafa',
              border: selectedStrategy === key ? `2px solid ${C.primary}` : '2px solid #eee',
              borderRadius: 10,
              marginBottom: 10,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 15, color: selectedStrategy === key ? C.primary : '#333' }}>
                {s.name}
              </span>
              <Tag color={s.direction === 'drop' ? 'danger' : 'success'} style={{ fontSize: 11 }}>
                {s.directionLabel}
              </Tag>
            </div>
            <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>{s.description}</div>
            <div style={{ fontSize: 11, color: '#999' }}>
              步骤: {s.steps.map(st => st.trigger).join(' → ')}
            </div>
            <div style={{ fontSize: 11, marginTop: 2 }}>
              <span style={{ color: C.success }}>优点: {s.pros}</span>
              <span style={{ color: '#ddd' }}> | </span>
              <span style={{ color: C.warning }}>缺点: {s.cons}</span>
            </div>
          </div>
        ))}
      </Card>

      {/* 基准价格和总资金 */}
      {selectedStrategy && (
        <Card title={<span style={{ color: C.primary }}>参数设置</span>} style={{ marginTop: 12 }}>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#333' }}>
              基准价格 <span style={{ fontSize: 11, color: '#999', fontWeight: 'normal' }}>（涨跌幅计算的起点）</span>
            </div>
            <Input type="number" placeholder="输入基准价格" value={basePrice} onChange={setBasePrice} style={{ '--font-size': '15px' }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6, color: '#333' }}>总资金（基准价 × 股数）</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>¥{basePrice || '0'}</span>
              <span style={{ fontSize: 13, color: '#999' }}>×</span>
              <div style={{ flex: 1 }}>
                <Input type="number" placeholder="输入股数" value={shares} onChange={setShares} style={{ '--font-size': '15px' }} />
              </div>
              <span style={{ fontSize: 13, color: '#666', whiteSpace: 'nowrap' }}>股</span>
            </div>
            {basePrice && shares && Number(basePrice) > 0 && Number(shares) > 0 && (
              <div style={{ fontSize: 13, color: C.primary, fontWeight: 600, padding: '6px 10px', background: C.lightBg, borderRadius: 6 }}>
                总资金 = ¥{(Number(basePrice) * Number(shares)).toFixed(2)}
              </div>
            )}
          </div>
          <div onClick={() => setShowAdvanced(!showAdvanced)} style={{ fontSize: 13, color: C.primary, cursor: 'pointer', marginBottom: showAdvanced ? 12 : 0 }}>
            {showAdvanced ? '▼ 收起高级设置' : '▶ 高级设置（提醒阈值）'}
          </div>
          {showAdvanced && (
            <div style={{ display: 'flex', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>接近提醒下限(%)</div>
                <Input type="number" value={alertMin} onChange={setAlertMin} placeholder="80" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>接近提醒上限(%)</div>
                <Input type="number" value={alertMax} onChange={setAlertMax} placeholder="90" />
              </div>
            </div>
          )}
          <Button block color="primary" loading={saving} onClick={handleSaveStrategy} style={{ marginTop: 16, background: C.primary, borderColor: C.primary }}>
            保存策略配置
          </Button>
        </Card>
      )}

      {/* 加仓进度 */}
      {config && stepsWithPrices.length > 0 && (
        <Card title={<span style={{ color: C.primary }}>加仓进度 - {strategies[config.strategy_type]?.name || config.strategy_type}</span>} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#666', marginBottom: 12, padding: '8px 12px', background: C.lightBg, borderRadius: 8 }}>
            <div>基准价: ¥{config.base_price} | 现价: ¥{currentPrice} | 总资金: ¥{config.total_capital}</div>
            <div style={{ marginTop: 4, color: Math.abs(changePercent) > 0 ? (configDir === 'drop' ? C.danger : C.success) : '#666' }}>
              基准价{configDir === 'drop' ? '跌' : '涨'} {absChange.toFixed(2)}% | 已投入: ¥{investedAmount.toFixed(2)}
            </div>
          </div>
          <Steps direction="vertical" current={currentStep}>
            {stepsWithPrices.map((step, idx) => {
              const isCompleted = idx < currentStep
              const isCurrent = idx === currentStep
              const direction = config.strategy_direction
              // 判断该步骤是否被价格触发（不管用户是否实际加仓）
              const isPriceTriggered = idx <= priceReachedIdx
              // 判断用户是否实际加仓
              const hasAddedRecord = addRecords[idx - 1]
              const status = isCompleted ? 'finish' : isCurrent ? 'process' : 'wait'
              return (
                <Steps.Step
                  key={idx}
                  status={status}
                  title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: isCurrent ? 600 : 400, color: isCompleted ? C.primary : isCurrent ? '#333' : '#999' }}>
                        {step.trigger}
                      </span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <Tag style={{ fontSize: 11, background: isCompleted ? C.tagBg : '#f5f5f5', color: isCompleted ? C.primary : '#999', border: 'none' }}>
                          {step.ratio * 100}%
                        </Tag>
                        <span style={{ fontSize: 12, color: '#666' }}>¥{step.trigger_price}</span>
                      </div>
                    </div>
                  }
                  description={
                    <div style={{ fontSize: 11, color: '#999' }}>
                      {step.threshold === 0 ? '建仓' :
                        direction === 'drop' ? `基准价跌${step.threshold}%` : `基准价涨${step.threshold}%`}
                      {isCompleted && hasAddedRecord && (
                        <span style={{ marginLeft: 8, color: C.success }}>
                          ✓ 已加仓 ¥{hasAddedRecord.add_price} × {hasAddedRecord.add_quantity}股
                        </span>
                      )}
                      {isCompleted && !hasAddedRecord && idx > 0 && isPriceTriggered && (
                        <span style={{ marginLeft: 8, color: C.warning }}>
                          ⚠ 已触发，待操作
                        </span>
                      )}
                    </div>
                  }
                />
              )
            })}
          </Steps>
        </Card>
      )}

      {/* 加仓记录 */}
      {addRecords.length > 0 && (
        <Card title={<span style={{ color: C.primary }}>加仓记录</span>} style={{ marginTop: 12 }}>
          {addRecords.map((record, idx) => (
            <div key={record.id || idx} style={{ padding: '8px 0', borderBottom: idx < addRecords.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 500, fontSize: 13 }}>第{record.step_number}次加仓</div>
                  <div style={{ fontSize: 12, color: '#999' }}>
                    {dayjs(record.createdAt).format('YYYY-MM-DD')} | ¥{record.add_price} | {record.add_quantity}股
                  </div>
                </div>
                <Tag style={{ background: C.tagBg, color: C.primary, border: 'none' }}>已完成</Tag>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* 手动检查按钮 + 结果 */}
      {config && (
        <div style={{ padding: '12px 0 20px' }}>
          <Button block color="warning" size="large" loading={checking} onClick={handleCheckAlert}
            style={{ background: C.accent, borderColor: C.accent, color: '#fff' }}>
            🔔 检查加仓提醒
          </Button>
          {checkResult && (
            <div style={{
              marginTop: 12, padding: 14, borderRadius: 10,
              background: checkResult.need_alert
                ? (checkResult.alert_type === 'trigger' ? '#fce4ec' : '#fff8e1')
                : C.lightBg,
              border: `1px solid ${checkResult.need_alert
                ? (checkResult.alert_type === 'trigger' ? C.danger : C.warning)
                : C.track}`,
            }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, color: checkResult.need_alert ? (checkResult.alert_type === 'trigger' ? C.danger : C.warning) : C.primary }}>
                {checkResult.need_alert
                  ? (checkResult.alert_type === 'trigger' ? '🔔 已触发加仓！' : '⚠️ 接近加仓节点')
                  : '✅ 暂未触发'}
              </div>
              <div style={{ fontSize: 13, color: '#333' }}>
                <div>当前{config.strategy_direction === 'drop' ? '跌幅' : '涨幅'}: {checkResult.change_percent}%</div>
                <div>触发阈值: {checkResult.threshold}%</div>
                {checkResult.approach_range && !checkResult.need_alert && (
                  <div>预警区间: {checkResult.approach_range.min}% - {checkResult.approach_range.max}%</div>
                )}
                {checkResult.add_amount && <div>建议加仓金额: ¥{checkResult.add_amount}</div>}
                {checkResult.add_quantity && <div>建议加仓数量: {checkResult.add_quantity}股 ({Math.floor(checkResult.add_quantity / 100)}手)</div>}
                {checkResult.email_sent && <div style={{ color: C.success, marginTop: 4 }}>📧 邮件已发送</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
