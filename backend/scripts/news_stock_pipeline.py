#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
新闻-股票匹配流水线
===================
模块一：正文抓取 —— 只处理 body 为空的 ShanghaiNews 记录，访问原文 URL 获取全文纯文本
模块二：jieba 匹配 —— 从 Stock 表加载全部股票名称构建词典，对 title+body 分词匹配
模块三：批量执行入口 —— 可单独运行匹配模块，不需要每次重爬网页

使用方法：
    python3 news_stock_pipeline.py --fetch          # 仅抓取正文
    python3 news_stock_pipeline.py --match           # 仅运行匹配（不抓网页）
    python3 news_stock_pipeline.py --fetch --match   # 先抓取再匹配
    python3 news_stock_pipeline.py --date 2026-10-14 # 只处理指定日期的新闻

依赖安装：
    pip3 install jieba pymysql requests beautifulsoup4 lxml
"""

import os
import sys
import re
import json
import time
import argparse
import traceback
import requests
from bs4 import BeautifulSoup

try:
    import jieba
except ImportError:
    print("❌ 请先安装 jieba: pip3 install jieba", file=sys.stderr)
    sys.exit(1)

try:
    import pymysql
except ImportError:
    print("❌ 请先安装 pymysql: pip3 install pymysql", file=sys.stderr)
    sys.exit(1)


# ========================= 配置 =========================

# 请求间隔（秒），基础反爬防护
REQUEST_SLEEP = 1.5

# 请求头
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                  'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
}

# 电子报基础 URL
EPAPER_BASE = 'http://paper.cnstock.com'


# ========================= 数据库 =========================

def load_env():
    """从 .env 文件加载环境变量（如果尚未设置）"""
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
    if os.path.exists(env_path):
        with open(env_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, val = line.split('=', 1)
                    os.environ.setdefault(key.strip(), val.strip())


def get_db():
    """获取 MySQL 连接"""
    load_env()
    return pymysql.connect(
        host=os.environ.get('DB_HOST', 'localhost'),
        port=int(os.environ.get('DB_PORT', 3306)),
        user=os.environ.get('DB_USER', 'tradeloguser'),
        password=os.environ.get('DB_PASSWORD', 'tradelog_password'),
        database=os.environ.get('DB_NAME', 'tradelog_db'),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor,
    )


# ========================= 股票词典（从 Stock 表加载） =========================

def load_stock_dict(conn):
    """
    从 Stock 表加载全部上市股票，构建 jieba 自定义词典。
    规则：
      - 候选词只能来自 Stock 表的 name（简称）和 full_name（全称）
      - 长词优先，全称排在简称前面，防止短词优先匹配造成切分错误
      - 禁止硬编码任何股票名单
    返回:
      stock_map: {code: {'code': ..., 'name': ..., 'full_name': ...}}
      name_to_code: {name/full_name: code}  用于快速查找
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT code, name, full_name FROM stocks WHERE list_status = 'LISTED'"
        )
        stocks = cur.fetchall()

    stock_map = {}
    name_to_code = {}

    # 按名称长度降序排列，确保长词优先加入词典
    stocks_sorted = sorted(stocks, key=lambda s: len(s.get('full_name') or s['name']), reverse=True)

    for s in stocks_sorted:
        code = s['code']
        name = s['name']
        full_name = s.get('full_name') or ''

        stock_map[code] = {'code': code, 'name': name, 'full_name': full_name}

        # 加入查找映射（全称和简称都映射到同一个 code）
        if full_name:
            name_to_code[full_name] = code
        name_to_code[name] = code

    print(f"📚 从数据库加载 {len(stock_map)} 只上市股票", file=sys.stderr)
    return stock_map, name_to_code


def setup_jieba(stock_map, name_to_code):
    """
    构建 jieba 自定义词典。
    规则：
      - 程序启动一次性加载，不重复加载
      - 长词优先：full_name（全称）排在 name（简称）前面
      - 简称的常见后缀变体也纳入词典（如 '股份'/'集团' 等后缀的简称部分）
    """
    # 按名称长度降序排列，确保长词优先匹配
    entries = []
    for code, info in stock_map.items():
        full_name = info.get('full_name', '')
        name = info['name']
        if full_name:
            entries.append((full_name, code, len(full_name) * 20))
        entries.append((name, code, len(name) * 15))
        # 简称去掉后缀的部分也加入（如 "贵州茅台" -> "茅台"）
        short = re.sub(r'(股份|集团|科技|电子|工业|控股|实业|能源|化工|材料|传媒|网络)$', '', name)
        if short and len(short) >= 2 and short != name:
            entries.append((short, code, len(short) * 12))

    # 按长度降序加入词典
    entries.sort(key=lambda x: len(x[0]), reverse=True)

    for word, code, freq in entries:
        jieba.add_word(word, freq=freq, tag='stock')

    print(f"📖 jieba 自定义词典构建完成：{len(entries)} 个词条", file=sys.stderr)


# ========================= 正文抓取与清洗 =========================

def clean_html(html_text):
    """
    清洗 HTML，提取可读纯文本。
    规则：
      - 剔除 HTML 标签、script/style 内容
      - 去除零宽字符
      - 合并多余换行和空格
      - 只保留可读文字，不存储原始 HTML
    """
    if not html_text:
        return ''

    soup = BeautifulSoup(html_text, 'lxml')

    # 移除 script 和 style 元素
    for tag in soup(['script', 'style', 'nav', 'header', 'footer', 'aside']):
        tag.decompose()

    # 尝试定位正文区域（按优先级尝试多种选择器）
    # ===== 可修改位置：根据实际页面结构调整选择器 =====
    content_selectors = [
        ('div', {'class': 'article-content'}),
        ('div', {'class': 'content'}),
        ('div', {'class': 'detail-content'}),
        ('div', {'class': 'text'}),
        ('div', {'id': 'Content'}),
        ('article', None),
        ('div', {'class': 'article-body'}),
    ]

    content_div = None
    for tag_name, attrs in content_selectors:
        content_div = soup.find(tag_name, attrs) if attrs else soup.find(tag_name)
        if content_div:
            break

    if not content_div:
        content_div = soup  # 降级：取整个页面

    text = content_div.get_text(separator='\n', strip=True)

    # 去除零宽字符
    text = re.sub(r'[\u200b\u200c\u200d\ufeff\u00a0]', '', text)
    # 合并连续空行
    text = re.sub(r'\n{3,}', '\n\n', text)
    # 合并行内多余空格
    text = re.sub(r'[ \t]+', ' ', text)

    return text.strip()


def fetch_article_body(url, timeout=12):
    """抓取单篇文章的正文纯文本"""
    if not url:
        return None
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
        resp.encoding = resp.apparent_encoding or 'utf-8'
        if resp.status_code == 200:
            return clean_html(resp.text)
        else:
            print(f"  ⚠️  HTTP {resp.status_code}: {url}", file=sys.stderr)
            return None
    except Exception as e:
        print(f"  ⚠️  请求失败: {url} - {e}", file=sys.stderr)
        return None


def fetch_bodies(date_filter=None):
    """
    【模块一：正文抓取】
    只处理 body 为空的 ShanghaiNews 记录，抓取上证报对应 URL 的文章。
    抓取失败打印日志，不中断整体批量任务。
    """
    conn = get_db()
    results = {'fetched': 0, 'failed': 0, 'skipped': 0, 'details': []}

    try:
        with conn.cursor() as cur:
            sql = ("SELECT id, title, url FROM shanghai_news "
                   "WHERE body IS NULL AND url IS NOT NULL AND url != ''")
            params = []
            if date_filter:
                sql += " AND publish_date = %s"
                params.append(date_filter)
            sql += " ORDER BY publish_date DESC, id ASC"
            cur.execute(sql, params)
            records = cur.fetchall()

        total = len(records)
        if total == 0:
            print("✅ 所有文章已有正文，无需抓取", file=sys.stderr)
            return results

        print(f"\n📝 开始抓取正文（共 {total} 篇 body 为空的文章）...", file=sys.stderr)

        for i, rec in enumerate(records):
            news_id = rec['id']
            title = rec['title']
            url = rec['url']

            # 确保电子报链接有完整 URL
            if url and not url.startswith('http'):
                if url.startswith('/'):
                    url = EPAPER_BASE + url
                elif url.startswith('content_'):
                    # 从 URL 推断日期路径
                    date_path = ''
                    if date_filter:
                        dt_parts = date_filter.split('-')
                        date_path = f"{dt_parts[0]}-{dt_parts[1]}/{dt_parts[2]}"
                    url = f"{EPAPER_BASE}/html/{date_path}/{url}"
                else:
                    url = EPAPER_BASE + '/' + url

            print(f"  [{i+1}/{total}] news_id={news_id} {title[:30]}...", file=sys.stderr)

            body = fetch_article_body(url)

            if body and len(body) > 20:
                with conn.cursor() as cur2:
                    cur2.execute(
                        "UPDATE shanghai_news SET body = %s WHERE id = %s",
                        (body, news_id)
                    )
                conn.commit()
                results['fetched'] += 1
                print(f"    ✅ 正文 {len(body)} 字", file=sys.stderr)
            else:
                results['failed'] += 1
                print(f"    ❌ 抓取失败或正文过短", file=sys.stderr)

            results['details'].append({
                'news_id': news_id,
                'status': 'ok' if (body and len(body) > 20) else 'failed',
                'body_len': len(body) if body else 0,
            })

            # 请求间隔，控制访问频率
            time.sleep(REQUEST_SLEEP)

    finally:
        conn.close()

    print(f"\n📊 正文抓取完成：成功 {results['fetched']}，失败 {results['failed']}", file=sys.stderr)
    return results


# ========================= jieba 股票匹配 =========================

def detect_stocks_jieba(text, stock_map, name_to_code, sorted_names=None):
    """
    使用 jieba 分词 + 子串扫描匹配文本中的股票。
    硬性约束：
      - 只有存在于 Stock 表 name/full_name 中的词汇才会被命中
      - 不在 Stock 表内的词汇一律忽略
      - 结果自动去重
    返回: [{code, name}, ...]
    """
    if not text:
        return []

    found = {}  # code -> {code, name}

    # 1. jieba 分词匹配
    words = jieba.cut(text)
    for word in words:
        word = word.strip()
        if len(word) < 2:
            continue
        if word in name_to_code:
            code = name_to_code[word]
            if code not in found:
                found[code] = {'code': code, 'name': stock_map[code]['name']}

    # 2. 子串扫描兜底（捕获 jieba 可能切碎的长名称变体）
    #    按名称长度降序检查，长词优先匹配（排序结果从外部传入避免重复计算）
    if sorted_names is None:
        sorted_names = sorted(name_to_code.keys(), key=len, reverse=True)
    for stock_name in sorted_names:
        if len(stock_name) < 2:
            continue
        if stock_name in text:
            code = name_to_code[stock_name]
            if code not in found:
                found[code] = {'code': code, 'name': stock_map[code]['name']}

    # 3. 6 位数字股票代码匹配
    code_matches = re.findall(r'(?<!\d)([036]\d{5})(?!\d)', text)
    for code in code_matches:
        if code in stock_map and code not in found:
            found[code] = {'code': code, 'name': stock_map[code]['name']}

    return list(found.values())


def run_matching(date_filter=None):
    """
    【模块二：jieba 匹配】
    对 ShanghaiNews 执行股票识别。
    匹配输入 = title + body（合并做分词匹配）。
    匹配结果双写同步：mentioned_stocks JSON + news_stock 关联表。
    每次重新匹配前先清空旧记录，避免重复脏数据。
    """
    conn = get_db()

    # 一次性加载全部股票名称生成 jieba 词典
    stock_map, name_to_code = load_stock_dict(conn)
    setup_jieba(stock_map, name_to_code)

    # 预计算排序后的名称列表（避免每篇文章重复排序）
    sorted_names = sorted(name_to_code.keys(), key=len, reverse=True)

    results = {'total': 0, 'updated': 0, 'details': []}

    try:
        # 查询全部新闻（按日期过滤可选）
        with conn.cursor() as cur:
            sql = "SELECT id, title, body, publish_date FROM shanghai_news"
            params = []
            if date_filter:
                sql += " WHERE publish_date = %s"
                params.append(date_filter)
            sql += " ORDER BY publish_date DESC, sort_order ASC"
            cur.execute(sql, params)
            news_list = cur.fetchall()

        total = len(news_list)
        results['total'] = total
        print(f"\n🔍 开始股票匹配（共 {total} 篇文章）...", file=sys.stderr)

        # 为写入操作创建专用连接（避免查询连接空闲超时）
        write_conn = get_db()

        for i, news in enumerate(news_list):
            news_id = news['id']
            title = news['title'] or ''
            body = news.get('body') or ''
            text = title + ' ' + body

            # 执行 jieba 匹配
            matched = detect_stocks_jieba(text, stock_map, name_to_code, sorted_names)
            matched_codes = [m['code'] for m in matched]

            # 清空该新闻在 news_stock 里的旧记录（先删后写）
            # 写入 news_stock 关联表（去重，同一篇新闻同一只股票只保留一条）
            # 覆盖 mentioned_stocks JSON（双写同步）
            try:
                cur2 = write_conn.cursor()
                cur2.execute("DELETE FROM news_stock WHERE news_id = %s", (news_id,))
                for code in set(matched_codes):
                    cur2.execute(
                        "INSERT IGNORE INTO news_stock (news_id, stock_code) VALUES (%s, %s)",
                        (news_id, code)
                    )
                cur2.execute(
                    "UPDATE shanghai_news SET mentioned_stocks = %s WHERE id = %s",
                    (json.dumps(matched, ensure_ascii=False), news_id)
                )
                write_conn.commit()
                cur2.close()
            except Exception as e:
                print(f"  ⚠️ news_id={news_id} 写入失败: {e}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)
                try:
                    write_conn.rollback()
                except Exception:
                    write_conn.close()
                    write_conn = get_db()

            results['updated'] += 1
            results['details'].append({
                'news_id': news_id,
                'stocks': matched_codes,
                'count': len(matched_codes),
            })

            if matched_codes:
                print(f"  [{i+1}/{total}] news_id={news_id} → {', '.join(matched_codes)}", file=sys.stderr)
            else:
                print(f"  [{i+1}/{total}] news_id={news_id} → 无匹配", file=sys.stderr)

        write_conn.close()

    finally:
        conn.close()

    print(f"\n📊 匹配完成：{results['total']} 篇文章，{results['updated']} 篇已更新", file=sys.stderr)
    return results


# ========================= 批量执行入口 =========================

def main():
    parser = argparse.ArgumentParser(description='新闻-股票匹配流水线')
    parser.add_argument('--fetch', action='store_true', help='抓取正文（只处理 body 为空的记录）')
    parser.add_argument('--match', action='store_true', help='运行 jieba 股票匹配（不抓网页）')
    parser.add_argument('--date', type=str, default=None, help='只处理指定日期 (YYYY-MM-DD)')
    args = parser.parse_args()

    # 禁用 SSL 警告
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

    if not args.fetch and not args.match:
        parser.print_help()
        print("\n示例：", file=sys.stderr)
        print("  python3 news_stock_pipeline.py --fetch          # 仅抓取正文", file=sys.stderr)
        print("  python3 news_stock_pipeline.py --match           # 仅运行匹配", file=sys.stderr)
        print("  python3 news_stock_pipeline.py --fetch --match   # 先抓取再匹配", file=sys.stderr)
        sys.exit(0)

    summary = {}

    # 模块一：正文抓取
    if args.fetch:
        print("=" * 50, file=sys.stderr)
        print("📝 模块一：正文抓取", file=sys.stderr)
        print("=" * 50, file=sys.stderr)
        fetch_result = fetch_bodies(args.date)
        summary['fetch'] = {
            'fetched': fetch_result['fetched'],
            'failed': fetch_result['failed'],
        }

    # 模块二：jieba 匹配（可单独运行，不需要每次重爬网页）
    if args.match:
        print("=" * 50, file=sys.stderr)
        print("🔍 模块二：jieba 股票匹配", file=sys.stderr)
        print("=" * 50, file=sys.stderr)
        match_result = run_matching(args.date)
        summary['match'] = {
            'total': match_result['total'],
            'updated': match_result['updated'],
            'details': match_result['details'],
        }

    # 输出 JSON 摘要到 stdout（供 Node.js 解析）
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f"\n❌ 致命错误: {e}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
