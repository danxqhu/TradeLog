#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
上海证券报电子报抓取脚本
========================
功能：
1. 抓取上海证券报电子报 (paper.cnstock.com) 当日文章
2. 抓取中国证券网证券频道 (cnstock.com/channel/10232) 最新文章
3. 提取文章标题、摘要、原文链接、提及的股票代码
4. 输出为 JSON 文件，并可选择推送到后端 API

使用方法：
    python3 shanghai_news_scraper.py                  # 抓取并输出 JSON
    python3 shanghai_news_scraper.py --push           # 抓取并推送到后端 API
    python3 shanghai_news_scraper.py --date 2026-10-11  # 抓取指定日期
    python3 shanghai_news_scraper.py --days 3         # 抓取最近 N 天

依赖安装：
    pip3 install requests beautifulsoup4 lxml
"""

import requests
from bs4 import BeautifulSoup
import json
import re
import os
import sys
import argparse
from datetime import datetime, timedelta

# ========== 配置 ==========
BASE_URL = "https://www.cnstock.com"
EPAPER_URL = "http://paper.cnstock.com"
API_BASE = "http://localhost:3001/api"
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")

# 常用 A 股股票代码正则（6位数字）
STOCK_CODE_PATTERN = re.compile(r'(?<!\d)([036]\d{5})(?!\d)')

# 常见股票名称与代码映射（部分，用于辅助识别）
# 实际使用时可以扩展或从数据库加载

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

# ========== 工具函数 ==========

def ensure_output_dir():
    """确保输出目录存在"""
    os.makedirs(OUTPUT_DIR, exist_ok=True)


def safe_request(url, timeout=15):
    """安全请求，带重试"""
    for attempt in range(3):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
            resp.encoding = resp.apparent_encoding or 'utf-8'
            if resp.status_code == 200:
                return resp
            print(f"  ⚠️  HTTP {resp.status_code}: {url}")
        except requests.RequestException as e:
            print(f"  ⚠️  请求失败(第{attempt+1}次): {url} - {e}")
    return None


def extract_stock_codes(text):
    """从文本中提取股票代码"""
    codes = set(STOCK_CODE_PATTERN.findall(text))
    return list(codes)


# ========== 抓取器 ==========

def scrape_ePaper(date_str=None):
    """
    抓取电子报页面
    从 paper.cnstock.com 获取当日报纸版面和文章列表
    """
    print(f"\n📰 正在抓取电子报...")

    articles = []

    # 抓取电子报主页（始终显示最新一期）
    url = EPAPER_URL + "/"

    resp = safe_request(url)
    if not resp:
        print("  ❌ 电子报主页请求失败")
        return articles

    soup = BeautifulSoup(resp.text, 'lxml')

    # 自动检测页面上的实际日期（如 "10月11日"）
    page_date = None
    date_match = re.search(r'(\d{1,2})月(\d{1,2})日', resp.text)
    if date_match:
        month = int(date_match.group(1))
        day = int(date_match.group(2))
        year = datetime.now().year
        page_date = f"{year}-{month:02d}-{day:02d}"
        print(f"  ℹ️  电子报显示日期: {page_date}")

    # 使用页面实际日期，而非系统日期
    actual_date = page_date or date_str or datetime.now().strftime("%Y-%m-%d")
    dt = datetime.strptime(actual_date, "%Y-%m-%d")
    date_path = dt.strftime("%Y-%m/%d")
    # 电子报页面结构：所有内容在一个 <div class="paper-list"> 中
    #   - 开头是 A1 的文章（没有版头）
    #   - 后续每个版面有一个概览 <li>（以 "A2版 基金·一周" 开头，后接拼接的文章标题）
    #   - 概览后面是该版面的文章 <li>
    section_pattern = re.compile(r'^([A-Z]\d+)版\s+(.+)')

    # 先从“版面导航”区提取版名映射（A1 -> 基金周刊, A2 -> 基金·一周...）
    section_names = {}
    for li in soup.find_all('li'):
        text = li.get_text(strip=True)
        m = re.match(r'^([A-Z]\d+)[：:．]\s*(.+)', text)
        if m:
            section_names[m.group(1)] = m.group(2)

    # 遍历 paper-list div
    current_section = "A1"  # 默认从 A1 开始
    for div in soup.find_all('div', class_='paper-list'):
        for li in div.find_all('li'):
            text = li.get_text(strip=True)
            if not text or len(text) < 2:
                continue

            # 检查是否是版面概览（以 "A2版 基金·一周" 格式开头，且长度>60说明是拼接的概览）
            m = section_pattern.match(text)
            if m and len(text) > 60:
                current_section = m.group(1)  # e.g. "A2"
                continue

            # 过滤掉其他过长的文本
            if len(text) > 60:
                continue

            # 构建版面显示名
            section_display = current_section
            if current_section in section_names:
                section_display = f"{current_section}：{section_names[current_section]}"

            # 这是一篇文章
            link = li.find('a')
            article_url = ""
            if link and link.get('href'):
                href = link['href']
                if href.startswith('http'):
                    article_url = href
                elif href.startswith('/'):
                    article_url = EPAPER_URL + href
                elif href.startswith('content_'):
                    article_url = f"{EPAPER_URL}/html/{date_path}/{href}"
                else:
                    article_url = f"{EPAPER_URL}/{href}"

            articles.append({
                "title": text,
                "section": section_display,
                "url": article_url,
                "source": "上海证券报",
                "publish_date": actual_date,
                "content": "",
                "mentioned_stocks": [],
            })

    # 如果上面没抓到文章，尝试从页面文本中直接提取
    if not articles:
        print("  ℹ️  尝试从页面文本提取文章列表...")
        # 查找所有列表项
        for item in soup.find_all(['li', 'a']):
            text = item.get_text(strip=True)
            if len(text) > 5 and len(text) < 100:
                link = item.find('a') if item.name == 'li' else item
                href = link.get('href', '') if link else ''
                article_url = ""
                if href:
                    if href.startswith('http'):
                        article_url = href
                    elif href.startswith('/'):
                        article_url = EPAPER_URL + href

                # 跳过导航链接
                if any(kw in text for kw in ['首页', '返回', '更多', '客户端', '登录']):
                    continue

                articles.append({
                    "title": text,
                    "section": "",
                    "url": article_url,
                    "source": "上海证券报",
                    "publish_date": actual_date,
                    "content": "",
                    "mentioned_stocks": [],
                })

    print(f"  ✅ 电子报抓取到 {len(articles)} 篇文章")
    return articles


def scrape_website_channel():
    """
    抓取中国证券网证券频道
    从 cnstock.com/channel/10232 获取最新证券新闻
    """
    print(f"\n🌐 正在抓取中国证券网证券频道...")

    articles = []
    url = f"{BASE_URL}/channel/10232"

    resp = safe_request(url)
    if not resp:
        print("  ❌ 证券频道请求失败")
        return articles

    soup = BeautifulSoup(resp.text, 'lxml')

    # 查找文章链接 - 匹配 /commonDetail/数字 格式
    seen_urls = set()
    # 清理标题中的多余信息（如 "券商·天风证券1小时前"）
    noise_pattern = re.compile(r'(券商|新股|A股|期货|债券|金融|产经).*?\d+.*?(前|小时前|天前|分钟)')

    for a_tag in soup.find_all('a', href=True):
        href = a_tag['href']
        title = a_tag.get_text(strip=True)

        # 清理标题：去掉 "券商·XXX 1小时前" 这类后缀
        title = noise_pattern.sub('', title).strip()
        # 去掉 "·" 后面的来源信息
        title = re.sub(r'[·•]\S+$', '', title).strip()
        # 去掉标题末尾的分类标签（券商、A股、新股、期货、债券等）
        title = re.sub(r'(券商|A股|新股|期货|债券|金融|产经|股市)$', '', title).strip()
        # 去掉标题末尾的 "！"
        title = title.rstrip('！').strip() if title.endswith('！') and len(title) > 10 else title

        # 过滤：标题长度合理，链接格式正确
        if (title and
            len(title) > 4 and
            len(title) < 60 and
            '/commonDetail/' in href):

            full_url = href if href.startswith('http') else BASE_URL + href

            if full_url not in seen_urls:
                seen_urls.add(full_url)
                articles.append({
                    "title": title,
                    "section": "",
                    "url": full_url,
                    "source": "上海证券报",
                    "publish_date": datetime.now().strftime("%Y-%m-%d"),
                    "content": "",
                    "mentioned_stocks": [],
                })

    print(f"  ✅ 证券频道抓取到 {len(articles)} 篇文章")
    return articles


def scrape_article_content(url):
    """
    抓取单篇文章的详细内容
    返回 (content_summary, mentioned_stocks)
    """
    if not url:
        return "", []

    resp = safe_request(url, timeout=10)
    if not resp:
        return "", []

    soup = BeautifulSoup(resp.text, 'lxml')

    # 尝试找到文章正文区域
    content_div = (
        soup.find('div', class_='article-content') or
        soup.find('div', class_='content') or
        soup.find('div', class_='detail-content') or
        soup.find('div', class_='text') or
        soup.find('article') or
        soup.find('div', id='Content')
    )

    if content_div:
        text = content_div.get_text(strip=True)
    else:
        # 如果找不到正文区域，取 body 文本的前 500 字
        text = soup.get_text(strip=True)[:500]

    # 截取摘要（前300字）
    summary = text[:300] if len(text) > 300 else text

    # 提取股票代码
    codes = extract_stock_codes(text)

    return summary, codes


def enrich_articles(articles, max_detail=20):
    """
    为文章补充详细内容（限制抓取数量避免太慢）
    """
    total = len(articles)
    to_enrich = min(total, max_detail)
    print(f"\n📝 正在获取文章详情（共 {total} 篇，处理前 {to_enrich} 篇）...")

    for i, article in enumerate(articles[:to_enrich]):
        if article.get('url'):
            print(f"  [{i+1}/{to_enrich}] {article['title'][:30]}...")
            content, codes = scrape_article_content(article['url'])
            article['content'] = content
            article['mentioned_stocks'] = [{"code": c, "name": ""} for c in codes]

    return articles


# ========== 输出 ==========

def save_to_json(articles, filename=None):
    """保存为 JSON 文件"""
    ensure_output_dir()
    if not filename:
        date_str = datetime.now().strftime("%Y%m%d_%H%M")
        filename = f"shanghai_news_{date_str}.json"

    filepath = os.path.join(OUTPUT_DIR, filename)

    # 去重（按标题）
    seen_titles = set()
    unique_articles = []
    for a in articles:
        if a['title'] not in seen_titles:
            seen_titles.add(a['title'])
            unique_articles.append(a)

    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(unique_articles, f, ensure_ascii=False, indent=2)

    print(f"\n💾 已保存到: {filepath}")
    print(f"   共 {len(unique_articles)} 篇文章（去重后）")
    return filepath


def push_to_api(articles):
    """推送到后端 API"""
    print(f"\n📤 正在推送到后端 API...")

    # 去重
    seen_titles = set()
    unique_articles = []
    for a in articles:
        if a['title'] not in seen_titles:
            seen_titles.add(a['title'])
            unique_articles.append(a)

    success = 0
    fail = 0

    for article in unique_articles:
        try:
            payload = {
                "publish_date": article.get("publish_date", datetime.now().strftime("%Y-%m-%d")),
                "title": article["title"],
                "content": article.get("content", ""),
                "url": article.get("url", ""),
                "mentioned_stocks": article.get("mentioned_stocks", []),
            }
            resp = requests.post(f"{API_BASE}/shanghai-news", json=payload, timeout=10)
            if resp.status_code in (200, 201):
                success += 1
            else:
                fail += 1
                print(f"  ⚠️  推送失败: {article['title'][:30]}... (HTTP {resp.status_code})")
        except Exception as e:
            fail += 1
            print(f"  ⚠️  推送异常: {article['title'][:30]}... ({e})")

    print(f"  ✅ 推送完成: 成功 {success} 篇, 失败 {fail} 篇")


def print_summary(articles):
    """打印摘要"""
    # 去重
    seen_titles = set()
    unique = []
    for a in articles:
        if a['title'] not in seen_titles:
            seen_titles.add(a['title'])
            unique.append(a)

    print(f"\n{'='*60}")
    print(f"📊 抓取结果汇总")
    print(f"{'='*60}")
    print(f"日期: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"文章总数: {len(unique)} 篇")
    print(f"{'='*60}")

    for i, a in enumerate(unique[:30], 1):
        stocks = ", ".join([s.get('code', '') for s in a.get('mentioned_stocks', [])])
        print(f"\n{i}. {a['title']}")
        if a.get('section'):
            print(f"   版面: {a['section']}")
        if a.get('url'):
            print(f"   链接: {a['url']}")
        if stocks:
            print(f"   提及股票: {stocks}")

    print(f"\n{'='*60}")


# ========== 主流程 ==========

def main():
    parser = argparse.ArgumentParser(description="上海证券报电子报抓取工具")
    parser.add_argument("--date", help="指定抓取日期 (YYYY-MM-DD)")
    parser.add_argument("--days", type=int, help="抓取最近 N 天")
    parser.add_argument("--push", action="store_true", help="推送到后端 API")
    parser.add_argument("--no-detail", action="store_true", help="跳过文章详情抓取（仅获取列表）")
    parser.add_argument("--max-detail", type=int, default=20, help="最多抓取详情的文章数（默认20）")
    args = parser.parse_args()

    # 禁用 SSL 警告
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    print("=" * 60)
    print("📰 上海证券报抓取工具")
    print(f"   时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    all_articles = []

    if args.days:
        # 抓取最近 N 天
        for i in range(args.days):
            dt = datetime.now() - timedelta(days=i)
            date_str = dt.strftime("%Y-%m-%d")
            articles = scrape_ePaper(date_str)
            all_articles.extend(articles)
    else:
        # 抓取电子报
        articles = scrape_ePaper(args.date)
        all_articles.extend(articles)

    # 抓取证券频道（始终抓取，补充电子报内容）
    channel_articles = scrape_website_channel()
    all_articles.extend(channel_articles)

    # 补充文章详情
    if not args.no_detail:
        all_articles = enrich_articles(all_articles, max_detail=args.max_detail)

    # 打印摘要
    print_summary(all_articles)

    # 保存 JSON
    save_to_json(all_articles)

    # 推送到 API
    if args.push:
        push_to_api(all_articles)

    print(f"\n✅ 全部完成！")


if __name__ == "__main__":
    main()
