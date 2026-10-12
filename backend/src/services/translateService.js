/**
 * 翻译服务 - 使用 Google Translate API 将英文翻译成中文
 */

const { translate } = require('@vitalets/google-translate-api');

/**
 * 翻译文本从英文到中文
 * @param {string} text - 要翻译的英文文本
 * @returns {Promise<string>} 翻译后的中文文本
 */
async function translateToChinese(text) {
  if (!text || typeof text !== 'string') return text;
  
  // 如果已经是中文（包含中文字符），直接返回
  if (/[\u4e00-\u9fa5]/.test(text) && !/[a-zA-Z]{3,}/.test(text)) {
    return text;
  }
  
  try {
    const result = await translate(text, { from: 'en', to: 'zh-CN' });
    return result.text;
  } catch (err) {
    console.error('翻译失败:', err.message);
    return text; // 翻译失败返回原文
  }
}

/**
 * 批量翻译文本
 * @param {string[]} texts - 要翻译的文本数组
 * @returns {Promise<string[]>} 翻译后的文本数组
 */
async function translateBatch(texts) {
  const results = [];
  for (const text of texts) {
    const translated = await translateToChinese(text);
    results.push(translated);
    // 避免请求过快被限制
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  return results;
}

module.exports = {
  translateToChinese,
  translateBatch,
};
