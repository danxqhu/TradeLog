import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import TabBar from './components/Layout/TabBar'
import { useAuth } from './utils/AuthContext'
import Home from './pages/Home'
import Watchlist from './pages/Watchlist'
import News from './pages/News'
import Features from './pages/Features'
import Recommendation from './pages/Recommendation'
import RecommendationDetail from './pages/Recommendation/Detail'
import VolumeAnalysis from './pages/Volume/Analysis'
import VolumeRealtime from './pages/Volume/Realtime'
import Position from './pages/Position'
import PositionStrategy from './pages/Position/Strategy'
import GoldmanSachs from './pages/GoldmanSachs'
import Shao from './pages/Shao'
import FinanceReport from './pages/FinanceReport'
import ChipDistribution from './pages/ChipDistribution'
import Rainbow from './pages/Rainbow'
import Email from './pages/Email'
import Login from './pages/Auth/Login'
import Register from './pages/Auth/Register'
import ForgotPassword from './pages/Auth/ForgotPassword'

function App() {
  const { isLoggedIn, loading } = useAuth()

  // 初始化中，显示空白
  if (loading) {
    return <div style={{ minHeight: '100vh', background: '#FAF0F1' }} />
  }

  // 未登录：只显示认证页面
  if (!isLoggedIn) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    )
  }

  // 已登录：显示所有业务路由 + TabBar
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

          {/* 量能分析 */}
          <Route path="/volume/analysis" element={<VolumeAnalysis />} />
          <Route path="/volume/realtime" element={<VolumeRealtime />} />

          {/* 仓位管理 */}
          <Route path="/position" element={<Position />} />
          <Route path="/position/strategy/:stockCode" element={<PositionStrategy />} />

          {/* 资讯 */}
          <Route path="/goldman-sachs" element={<GoldmanSachs />} />
          <Route path="/shanghai-news" element={<News />} />

          {/* 邵先生 */}
          <Route path="/shao" element={<Shao />} />

          {/* 财报分析 */}
          <Route path="/finance-report" element={<FinanceReport />} />

          {/* 筹码分布 */}
          <Route path="/chip-distribution" element={<ChipDistribution />} />

          {/* 七道彩虹 */}
          <Route path="/rainbow" element={<Rainbow />} />

          {/* 邮件推送 */}
          <Route path="/email" element={<Email />} />

          {/* 默认重定向 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <TabBar />
    </>
  )
}

export default App
