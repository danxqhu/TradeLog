import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import TabBar from './components/Layout/TabBar'
import Home from './pages/Home'
import Watchlist from './pages/Watchlist'
import News from './pages/News'
import Features from './pages/Features'
import Recommendation from './pages/Recommendation'
import RecommendationDetail from './pages/Recommendation/Detail'
import RecommendationCalendar from './pages/Recommendation/Calendar'
import VolumeAnalysis from './pages/Volume/Analysis'
import VolumeRealtime from './pages/Volume/Realtime'
import Position from './pages/Position'
import PositionStrategy from './pages/Position/Strategy'
import ShanghaiNews from './pages/ShanghaiNews'
import GoldmanSachs from './pages/GoldmanSachs'

function App() {
  return (
    <>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Routes>
          {/* 底部Tab页 */}
          <Route path="/" element={<Home />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/news" element={<News />} />
          <Route path="/features" element={<Features />} />

          {/* 推荐管理 */}
          <Route path="/recommendation" element={<Recommendation />} />
          <Route path="/recommendation/:id" element={<RecommendationDetail />} />
          <Route path="/recommendation/calendar" element={<RecommendationCalendar />} />

          {/* 量能分析 */}
          <Route path="/volume/analysis" element={<VolumeAnalysis />} />
          <Route path="/volume/realtime" element={<VolumeRealtime />} />

          {/* 仓位管理 */}
          <Route path="/position" element={<Position />} />
          <Route path="/position/strategy/:stockCode" element={<PositionStrategy />} />

          {/* 资讯 */}
          <Route path="/shanghai-news" element={<ShanghaiNews />} />
          <Route path="/goldman-sachs" element={<GoldmanSachs />} />

          {/* 默认重定向 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <TabBar />
    </>
  )
}

export default App
