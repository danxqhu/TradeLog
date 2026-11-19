import { Dialog } from 'antd-mobile'

// 统一提示弹窗：必须用户手动点「关闭」才消失（替代自动 3 秒消失的 Toast）
// 按产品要求：所有提示类弹窗都需要用户亲自确认后才能看清内容
export const showAlert = (content, title = '提示') =>
  Dialog.alert({
    title,
    content,
    confirmText: '关闭',
  })
