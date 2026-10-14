#!/usr/bin/env python3
"""
获取全A每日成交额（增量模式）
数据源优先级：
  1. 主源：AKShare（封装了交易所官网数据）
  2. 兜底：直接请求交易所官网 API

用法：
  python3 fetch_market_averages.py --from-date 2026-10-09
    → 只抓取 2026-10-09 之后到今天的交易日数据
  python3 fetch_market_averages.py --days 80
    → 抓取最近80个交易日（全量模式，用于首次初始化）

输出格式：
  [
    {
      "date": "2026-10-13",
      "sse": 7802.55,      # 沪市A股成交额（亿元）
      "szse": 8975.75,     # 深市A股成交额（亿元）
      "bse": null,         # 北交所成交额（亿元），null表示未获取
      "complete": false    # 数据是否完整（三个交易所都有数据）
    },
    ...
  ]
"""
import json
import sys
import re
import subprocess
import time
from datetime import datetime, timedelta

# 尝试导入 akshare
try:
    import akshare as ak
    AKSHARE_AVAILABLE = True
except ImportError:
    AKSHARE_AVAILABLE = False
    print("⚠ AKShare 未安装，使用兜底源", file=sys.stderr)

try:
    import requests
except ImportError:
    print(json.dumps({"error": "requests not installed"}))
    sys.exit(1)


# ============ AKShare 主数据源 ============

def fetch_sse_akshare(date_fmt):
    """使用 AKShare 获取上交所股票成交额（亿元）"""
    if not AKSHARE_AVAILABLE:
        return None
    
    # date_fmt: "2026-10-13" -> "20261013"
    date_str = date_fmt.replace('-', '')
    
    try:
        df = ak.stock_sse_deal_daily(date=date_str)
        if df is None or df.empty:
            return None
        
        # 找到"成交金额"行，"股票"列的值
        for idx, row in df.iterrows():
            if row.iloc[0] == '成交金额':
                # 股票列是第1列（索引1）
                amount = row.iloc[1]
                if amount and float(amount) > 0:
                    return round(float(amount), 2)
        return None
    except Exception as e:
        print(f"  [AKShare] SSE {date_fmt}: {e}", file=sys.stderr)
        return None


def fetch_szse_akshare(date_fmt):
    """使用 AKShare 获取深交所A股成交额（亿元）"""
    if not AKSHARE_AVAILABLE:
        return None
    
    # date_fmt: "2026-10-13" -> "20261013"
    date_str = date_fmt.replace('-', '')
    
    try:
        df = ak.stock_szse_summary(date=date_str)
        if df is None or df.empty:
            return None
        
        # 找到"股票"行的成交金额
        # 需要主板A股 + 创业板A股
        total = 0
        found = False
        
        for idx, row in df.iterrows():
            category = str(row.iloc[0]).strip()
            if category in ['主板A股', '创业板A股']:
                amount = row.iloc[2]  # 成交金额列
                if amount and float(amount) > 0:
                    total += float(amount)
                    found = True
        
        if found and total > 0:
            # 单位是元，转为亿元
            return round(total / 1e8, 2)
        return None
    except Exception as e:
        print(f"  [AKShare] SZSE {date_fmt}: {e}", file=sys.stderr)
        return None


# ============ 兜底数据源（直接请求交易所官网） ============

def fetch_sse_fallback(date_fmt):
    """兜底：上交所全A成交额（亿元）"""
    # date_fmt: "2026-10-13" -> "2026-10-13" (格式相同)
    date_parts = date_fmt.split('-')
    date_query = f"{date_parts[0]}-{date_parts[1]}-{date_parts[2]}"
    
    url = (
        "https://query.sse.com.cn/commonQuery.do?"
        "jsonCallBack=cb"
        "&sqlId=COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C"
        "&PRODUCT_CODE=01,02,03,11,17"
        "&type=inParams"
        f"&SEARCH_DATE={date_query}"
    )
    try:
        result = subprocess.run(
            ["curl", "-s", "-m", "15",
             "-H", "Referer: https://www.sse.com.cn/market/stockdata/overview/day/",
             "-H", "User-Agent: Mozilla/5.0",
             url],
            capture_output=True, text=True, timeout=20
        )
        text = result.stdout.strip()
        if not text:
            return None
        match = re.search(r'cb\((.*)\)', text, re.DOTALL)
        if not match:
            return None
        data = json.loads(match.group(1))
        records = data.get('result', [])
        if not records:
            return None
        total = 0
        for r in records:
            if r.get('PRODUCT_CODE') in ('01', '03'):
                total += float(r.get('TRADE_AMT', 0) or 0)
        return round(total, 2) if total > 0 else None
    except Exception as e:
        print(f"  [兜底] SSE {date_fmt}: {e}", file=sys.stderr)
        return None


def fetch_szse_fallback(date_fmt):
    """兜底：深交所全A成交额（亿元）"""
    url = 'https://www.szse.cn/api/report/ShowReport/data'
    params = {
        'SHOWTYPE': 'JSON',
        'CATALOGID': '1803_sczm',
        'loading': 'first',
        'txtQueryDate': date_fmt,
    }
    try:
        r = requests.get(url, params=params,
                         headers={'User-Agent': 'Mozilla/5.0'},
                         timeout=15)
        data = r.json()
        if not data or not isinstance(data, list):
            return None
        items = data[0].get('data', [])
        total = 0
        found = False
        for item in items:
            name = re.sub(r'&nbsp;|\s', '', item.get('lbmc', ''))
            cjje = item.get('cjje', '0')
            val = float(cjje.replace(',', '')) if cjje else 0
            if name in ('主板A股', '创业板A股'):
                total += val
                found = True
        return round(total, 2) if found and total > 0 else None
    except Exception as e:
        print(f"  [兜底] SZSE {date_fmt}: {e}", file=sys.stderr)
        return None


# ============ 统一接口 ============

def fetch_sse(date_fmt):
    """获取上交所数据，优先 AKShare，失败则用兜底"""
    result = fetch_sse_akshare(date_fmt)
    if result:
        return result
    # AKShare 失败，用兜底
    return fetch_sse_fallback(date_fmt)


def fetch_szse(date_fmt):
    """获取深交所数据，优先 AKShare，失败则用兜底"""
    result = fetch_szse_akshare(date_fmt)
    if result:
        return result
    # AKShare 失败，用兜底
    return fetch_szse_fallback(date_fmt)


# ============ 日期工具 ============

def get_weekdays_between(from_date_str, to_date=None):
    """获取 from_date 到 to_date 之间的工作日列表（升序）"""
    if to_date is None:
        to_date = datetime.now()
    else:
        to_date = datetime.strptime(to_date, '%Y-%m-%d')

    from_date = datetime.strptime(from_date_str, '%Y-%m-%d')
    dates = []
    d = from_date + timedelta(days=1)
    while d <= to_date:
        if d.weekday() < 5:
            dates.append(d.strftime('%Y-%m-%d'))
        d += timedelta(days=1)
    return dates


def get_recent_weekdays(n):
    """获取最近 n 个工作日（升序）"""
    today = datetime.now()
    dates = []
    d = today
    while len(dates) < n:
        if d.weekday() < 5:
            dates.append(d.strftime('%Y-%m-%d'))
        d -= timedelta(days=1)
    dates.reverse()
    return dates


# ============ 主流程 ============

def main():
    args = sys.argv[1:]
    from_date = None
    n_days = 80

    for i, arg in enumerate(args):
        if arg == '--from-date' and i + 1 < len(args):
            from_date = args[i + 1]
        elif arg == '--days' and i + 1 < len(args):
            n_days = int(args[i + 1])

    # 确定要抓取的日期列表
    if from_date:
        # 增量模式：只抓 from_date 之后的日期
        trade_dates = get_weekdays_between(from_date)
        print(f"增量模式：从 {from_date} 之后抓取 {len(trade_dates)} 个工作日", file=sys.stderr)
    else:
        # 全量模式：最近 n 个工作日
        trade_dates = get_recent_weekdays(n_days)
        print(f"全量模式：抓取最近 {n_days} 个交易日", file=sys.stderr)

    data_source = "AKShare + 兜底" if AKSHARE_AVAILABLE else "仅兜底"
    print(f"  数据源: {data_source}", file=sys.stderr)

    result = []
    complete_count = 0
    incomplete_count = 0
    
    # 从最近的日期开始遍历
    for date_fmt in reversed(trade_dates):
        sse = fetch_sse(date_fmt)
        time.sleep(0.3)  # 避免请求过快
        szse = fetch_szse(date_fmt)
        time.sleep(0.3)
        
        # 北交所数据暂时设为 null（需要从其他数据源获取）
        bse = None

        # 判断数据完整性
        is_complete = (sse is not None) and (szse is not None) and (bse is not None)
        
        if is_complete:
            complete_count += 1
        elif sse is not None or szse is not None:
            incomplete_count += 1

        # 只要有任何数据就记录
        if sse is not None or szse is not None:
            record = {
                "date": date_fmt,
                "sse": sse,
                "szse": szse,
                "bse": bse,
                "complete": is_complete
            }
            result.append(record)
            
            status = "✓" if is_complete else "⚠不完整"
            sse_str = f"{sse:.2f}" if sse else "N/A"
            szse_str = f"{szse:.2f}" if szse else "N/A"
            bse_str = f"{bse:.2f}" if bse else "N/A"
            print(f"  {date_fmt}: SSE={sse_str} SZSE={szse_str} BSE={bse_str} {status}", file=sys.stderr)

    if not result:
        if from_date:
            # 增量模式无新数据，正常退出
            print(f"无新数据可抓取（from_date={from_date}）", file=sys.stderr)
            print(json.dumps([]))
            return
        else:
            print(json.dumps({"error": "未获取到任何数据"}))
            sys.exit(1)

    # 按日期正序
    result.sort(key=lambda x: x['date'])

    print(f"\n完成！共 {len(result)} 条记录（完整: {complete_count}，不完整: {incomplete_count}）", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
