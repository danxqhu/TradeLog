#!/usr/bin/env python3
"""
从三大交易所官网直接获取每日A股成交额（剔除B股）
数据来源：
  - 上交所 (SSE): query.sse.com.cn API → 主板A + 科创板（亿元）
  - 深交所 (SZSE): www.szse.cn/api API → 主板A股 + 创业板A股（亿元）
  - 北交所 (BSE): 占比极小(~0.03%)，暂设为0
输出：JSON 格式到 stdout，供 Node.js 后端读取

用法：
  python3 fetch_exchange_daily.py                  # 增量模式：只抓取数据库中缺失的日期
  python3 fetch_exchange_daily.py --full            # 全量模式：抓取最近150个交易日
  python3 fetch_exchange_daily.py --days 5          # 抓取最近N个交易日
"""
import json
import sys
import os
import re
import subprocess
import time
from datetime import datetime

try:
    import requests
    import pandas as pd
except ImportError:
    print(json.dumps({"error": "requests or pandas not installed"}))
    sys.exit(1)


# ============ 上交所 (SSE) - 通过 curl 调用 ============

def fetch_sse(date_fmt):
    """
    上交所A股成交额（亿元）
    date_fmt: 'YYYY-MM-DD' 格式
    返回: {main_a, star, total} 或 None
    """
    url = (
        "https://query.sse.com.cn/commonQuery.do?"
        "jsonCallBack=cb"
        "&sqlId=COMMON_SSE_SJ_GPSJ_CJGK_MRGK_C"
        "&PRODUCT_CODE=01,02,03,11,17"
        "&type=inParams"
        f"&SEARCH_DATE={date_fmt}"
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

        main_a = 0
        star = 0
        for r in records:
            code = r.get('PRODUCT_CODE', '')
            amt = float(r.get('TRADE_AMT', 0) or 0)
            if code == '01':  # 主板A
                main_a = amt
            elif code == '03':  # 科创板
                star = amt

        return {
            'main_a': round(main_a, 2),
            'star': round(star, 2),
            'total': round(main_a + star, 2),
        }
    except Exception as e:
        print(f"  上交所 {date_fmt} 失败: {e}", file=sys.stderr)
        return None


# ============ 深交所 (SZSE) - 通过 requests 调用 ============

def fetch_szse(date_fmt):
    """
    深交所A股成交额（亿元）
    date_fmt: 'YYYY-MM-DD' 格式
    返回: {main_a, gem, total} 或 None
    """
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
        if not data or not isinstance(data, list) or len(data) == 0:
            return None

        items = data[0].get('data', [])
        if not items:
            return None

        main_a = 0
        gem = 0
        for item in items:
            name = item.get('lbmc', '').strip()
            # 去掉 &nbsp; 前缀
            name = re.sub(r'&nbsp;|\s', '', name)
            cjje = item.get('cjje', '0')
            # 成交金额格式: "4,287.45" （带千分位逗号）
            val = float(cjje.replace(',', '')) if cjje else 0

            if name == '主板A股':
                main_a = val
            elif name == '创业板A股':
                gem = val

        return {
            'main_a': round(main_a, 2),
            'gem': round(gem, 2),
            'total': round(main_a + gem, 2),
        }
    except Exception as e:
        print(f"  深交所 {date_fmt} 失败: {e}", file=sys.stderr)
        return None


# ============ 交易日历 ============

def get_trading_dates(n_days=150):
    """
    获取最近 n_days 个交易日的日期列表
    简单方式：排除周末，不精确处理节假日（抓取时会自动跳过无数据的日期）
    """
    today = datetime.now()
    dates = []
    d = today
    while len(dates) < n_days:
        if d.weekday() < 5:  # 周一到周五
            dates.append(d.strftime('%Y-%m-%d'))
        d = d - __import__('datetime').timedelta(days=1)
    dates.reverse()
    return dates


def get_weekdays_between(from_date_str, to_date=None):
    """获取 from_date 到 to_date 之间的工作日列表（升序，不含 from_date 当天）"""
    from datetime import timedelta
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


# ============ 主流程 ============

def fetch_one_day(date_fmt):
    """抓取单日数据"""
    sse = fetch_sse(date_fmt)
    time.sleep(0.2)
    szse = fetch_szse(date_fmt)
    time.sleep(0.2)

    if sse is None and szse is None:
        return None

    sse_total = sse['total'] if sse else None
    szse_total = szse['total'] if szse else None
    # 只有两个源都成功时才计算合计，否则标记为不完整（None）
    is_complete = sse is not None and szse is not None
    total_amount = round(sse_total + szse_total, 2) if is_complete else None

    return {
        "date": date_fmt,
        "sse_main_a": sse['main_a'] if sse else None,
        "sse_star": sse['star'] if sse else None,
        "sse_total": sse_total,
        "szse_main_a": szse['main_a'] if szse else None,
        "szse_gem": szse['gem'] if szse else None,
        "szse_total": szse_total,
        "bse_total": 0,
        "total_amount": total_amount,
        "data_complete": is_complete,
    }


def main():
    # 解析参数
    args = sys.argv[1:]
    full_mode = '--full' in args
    from_date = None
    n_days = 150 if full_mode else 80

    for i, arg in enumerate(args):
        if arg == '--days' and i + 1 < len(args):
            n_days = int(args[i + 1])
        elif arg == '--from-date' and i + 1 < len(args):
            from_date = args[i + 1]

    # 确定要抓取的日期列表
    if from_date:
        # 增量模式：只抓 from_date 之后的工作日
        trade_dates = get_weekdays_between(from_date)
        if not trade_dates:
            print(f"已经是最新，无需抓取（from_date={from_date}）", file=sys.stderr)
            print(json.dumps([]))
            return
        print(f"增量模式：从 {from_date} 之后抓取 {len(trade_dates)} 个工作日", file=sys.stderr)
        # 从最近日期往前遍历
        trade_dates.reverse()
    else:
        # 全量模式：最近 N 个交易日
        trade_dates = get_trading_dates(n_days + 30)
        trade_dates.reverse()  # 从最近开始
        print(f"全量模式：抓取最近 {n_days} 个交易日", file=sys.stderr)

    print(f"  数据源: SSE官网API (curl) + SZSE官网API (requests)", file=sys.stderr)

    result = []
    fetched = 0
    target = len(trade_dates) if from_date else n_days
    for date_fmt in trade_dates:
        if fetched >= target:
            break

        record = fetch_one_day(date_fmt)

        if record is None:
            # 可能是节假日或数据尚未发布，静默跳过
            continue

        result.append(record)
        fetched += 1
        sse_str = f"{record['sse_total']:.0f}" if record['sse_total'] is not None else 'N/A'
        szse_str = f"{record['szse_total']:.0f}" if record['szse_total'] is not None else 'N/A'
        total_str = f"{record['total_amount']:.0f}" if record['total_amount'] is not None else 'N/A'
        complete_tag = '' if record.get('data_complete') else ' [不完整]'
        print(f"  [{fetched}/{target}] {date_fmt}: 沪={sse_str}亿 深={szse_str}亿 合计={total_str}亿{complete_tag}", file=sys.stderr)

    if not result:
        if from_date:
            # 增量模式无新数据，正常退出
            print(f"无新数据可抓取（from_date={from_date}）", file=sys.stderr)
            print(json.dumps([]))
            return
        else:
            print(json.dumps({"error": "未获取到任何数据"}))
            sys.exit(1)

    # 按日期正序排列（从旧到新）
    result.sort(key=lambda x: x['date'])

    # 计算滚动均线
    df = pd.DataFrame(result)
    df["ma20"] = df["total_amount"].rolling(window=20).mean()
    df["ma60"] = df["total_amount"].rolling(window=60).mean()

    # 输出最近 80 条
    output = df.tail(80).to_dict("records")
    for row in output:
        row["ma20"] = round(row["ma20"], 2) if pd.notna(row["ma20"]) else None
        row["ma60"] = round(row["ma60"], 2) if pd.notna(row["ma60"]) else None
        for key in ["sse_main_a", "sse_star", "sse_total", "szse_main_a", "szse_gem", "szse_total", "bse_total", "total_amount"]:
            if row.get(key) is not None:
                row[key] = round(row[key], 2)

    print(json.dumps(output, ensure_ascii=False))
    print(f"\n完成！共 {len(output)} 条记录", file=sys.stderr)


if __name__ == "__main__":
    main()
