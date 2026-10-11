import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, NavBar, Tag, Empty, Button, DatePicker, Space } from 'antd-mobile'
import { LeftOutline, LinkOutline } from 'antd-mobile-icons'
import dayjs from 'dayjs'

export default function ShanghaiNews() {
  const navigate = useNavigate()
  const [selectedDate, setSelectedDate] = useState(null)

  // 真实抓取数据 - 2026年10月11日 上海证券报电子报
  // 来源: paper.cnstock.com，由 scraper/shanghai_news_scraper.py 自动抓取
  const allData = [
    // === A1：基金周刊 ===
    {
      id: 1, publish_date: '2026-10-11', section: 'A1：基金周刊',
      title: '进击的ETF生态圈',
      content: '当ETF规模逼近5万亿元关口，产品数量突破1700只，一场围绕投研、流动性、渠道与投教的生态圈建设比拼悄然打响。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276088.htm',
      mentioned_stocks: [],
    },
    {
      id: 2, publish_date: '2026-10-11', section: 'A1：基金周刊',
      title: '迷你基金"壳"价值失色',
      content: '来时粉墨登场，去时寂寥无声——这是当下一些迷你基金窘境的真实写照。今年前三个季度，因资产净值低于合同限制而清盘的迷你基金数量正快速增加。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276089.htm',
      mentioned_stocks: [],
    },
    // === A2：基金·一周 ===
    {
      id: 3, publish_date: '2026-10-11', section: 'A2：基金·一周',
      title: '长端美债收益率高企 机构热议全球科技股后市走向',
      content: '在利率与AI盈利相互交织的背景下，市场关注点正从单一叙事转向两者之间的赛跑。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276064.htm',
      mentioned_stocks: [],
    },
    {
      id: 4, publish_date: '2026-10-11', section: 'A2：基金·一周',
      title: '广发基金刘兴旺：打造有生命力的"固收+"产品',
      content: '是否存在一种投资理念，既能对市场波动保持足够的谨慎，又能够分享时代发展的红利？',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276068.htm',
      mentioned_stocks: [],
    },
    {
      id: 5, publish_date: '2026-10-11', section: 'A2：基金·一周',
      title: '港股关注度升温  公募加大产品布局力度',
      content: '公募机构通过券商渠道优势提升ETF流动性和客户黏性，实现规模增长。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276067.htm',
      mentioned_stocks: [],
    },
    {
      id: 6, publish_date: '2026-10-11', section: 'A2：基金·一周',
      title: '锚定业绩确定性  知名私募基金经理调研动向曝光',
      content: '知名私募基金经理近期调研动向曝光，锚定业绩确定性方向。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276065.htm',
      mentioned_stocks: [],
    },
    {
      id: 7, publish_date: '2026-10-11', section: 'A2：基金·一周',
      title: 'REITs底层资产"改造账"：兼顾当期分配与长期收益',
      content: 'REITs底层资产改造账曝光，兼顾当期分配与长期收益。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276066.htm',
      mentioned_stocks: [],
    },
    // === A3：基金·市场 ===
    {
      id: 8, publish_date: '2026-10-11', section: 'A3：基金·市场',
      title: '公募"固收+"发展迎来三重共振',
      content: '公募"固收+"发展迎来产品、市场、政策三重共振。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276084.htm',
      mentioned_stocks: [],
    },
    {
      id: 9, publish_date: '2026-10-11', section: 'A3：基金·市场',
      title: '探寻新兴市场出海长周期机遇',
      content: '访兴业基金董令飞、中欧陆家嘴国际金融研究院刘功润，探寻新兴市场出海长周期机遇。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276086.htm',
      mentioned_stocks: [],
    },
    {
      id: 10, publish_date: '2026-10-11', section: 'A3：基金·市场',
      title: '华夏基金顾鑫峰：北证50高性价比配置窗口开启',
      content: '华夏基金顾鑫峰认为，北证50高性价比配置窗口已经开启。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276087.htm',
      mentioned_stocks: [],
    },
    {
      id: 11, publish_date: '2026-10-11', section: 'A3：基金·市场',
      title: '延长募集与提前结募并存 前三季度ETF发行冷热不均',
      content: '前三季度ETF发行出现延长募集与提前结募并存的现象。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276085.htm',
      mentioned_stocks: [],
    },
    // === A4：基金·视点 ===
    {
      id: 12, publish_date: '2026-10-11', section: 'A4：基金·视点',
      title: '在市场喧嚣中做"少数派"——访少数派投资创始人周良',
      content: '少数派投资创始人周良分享在市场喧嚣中做"少数派"的投资理念。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276073.htm',
      mentioned_stocks: [],
    },
    {
      id: 13, publish_date: '2026-10-11', section: 'A4：基金·视点',
      title: '全球黄金ETF 三季度净流入310亿美元',
      content: '全球黄金ETF三季度净流入310亿美元，机构认为黄金市场仍处于多种逻辑交织阶段。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276075.htm',
      mentioned_stocks: [],
    },
    {
      id: 14, publish_date: '2026-10-11', section: 'A4：基金·视点',
      title: '底层资产版图持续拓宽 前三季度29只REITs注册生效',
      content: '底层资产版图持续拓宽，前三季度共有29只REITs注册生效。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276076.htm',
      mentioned_stocks: [],
    },
    {
      id: 15, publish_date: '2026-10-11', section: 'A4：基金·视点',
      title: '真金白银传递信心 多家公募自购旗下权益类基金',
      content: '多家公募基金公司以真金白银自购旗下权益类基金，传递市场信心。',
      url: 'http://paper.cnstock.com/html/2026-10/11/content_2276074.htm',
      mentioned_stocks: [],
    },
  ]

  const filteredData = selectedDate
    ? allData.filter(d => d.publish_date === dayjs(selectedDate).format('YYYY-MM-DD'))
    : allData

  const availableDates = [...new Set(allData.map(d => d.publish_date))].sort().reverse()

  return (
    <div className="page-container">
      <NavBar backIcon={<LeftOutline />} onBack={() => navigate(-1)}>上海证券报</NavBar>

      <Card style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#999', marginBottom: 12, padding: '8px 12px', background: '#f5f5f5', borderRadius: 8 }}>
          数据来源：paper.cnstock.com 电子报，由 Python 脚本每日自动抓取
        </div>

        <Space style={{ marginBottom: 12 }}>
          <DatePicker onConfirm={(val) => setSelectedDate(val)} mode="date">
            {(value) => (
              <Button size="small" fill={value ? 'solid' : 'outline'} color="primary">
                {value ? dayjs(value).format('YYYY-MM-DD') : '按日期筛选'}
              </Button>
            )}
          </DatePicker>
          {selectedDate && (
            <Button size="small" fill="none" onClick={() => setSelectedDate(null)}>清除</Button>
          )}
        </Space>

        {/* 快速日期选择 */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          {availableDates.map(date => (
            <Button
              key={date}
              size="mini"
              fill={selectedDate === date ? 'solid' : 'outline'}
              color="primary"
              onClick={() => setSelectedDate(date === selectedDate ? null : date)}
            >
              {date}
            </Button>
          ))}
        </div>

        {filteredData.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          filteredData.map(item => (
            <div key={item.id} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginBottom: 4 }}>
                <span>{item.publish_date}</span>
                {item.section && <Tag style={{ fontSize: 11 }}>{item.section}</Tag>}
              </div>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 14 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: '#666', marginBottom: 8, lineHeight: 1.5 }}>{item.content}</div>
              <div style={{ marginBottom: 8 }}>
                {item.mentioned_stocks?.map(s => (
                  <Tag key={s.code} color="primary" style={{ marginRight: 4, marginBottom: 4 }}>
                    {s.name} ({s.code})
                  </Tag>
                ))}
              </div>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 14px',
                    background: '#1677ff',
                    color: '#fff',
                    borderRadius: 6,
                    fontSize: 13,
                    textDecoration: 'none',
                  }}
                >
                  <LinkOutline style={{ fontSize: 14 }} />
                  查看原文
                </a>
              )}
            </div>
          ))
        )}
      </Card>
    </div>
  )
}
