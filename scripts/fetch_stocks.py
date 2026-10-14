#!/usr/bin/env python3
"""
从 AKShare 拉取全市场 A 股列表，输出 JSON 到 stdout
用法: python3 fetch_stocks.py
输出: [{"code": "000001", "name": "平安银行"}, ...]
"""
import json
import sys
import warnings
warnings.filterwarnings('ignore')

try:
    import akshare as ak

    print('正在通过 AKShare 拉取全市场 A 股...', file=sys.stderr)

    # stock_zh_a_spot() 用新浪源，返回代码格式如 "sh600000" / "sz000001" / "bj920000"
    df = ak.stock_zh_a_spot()

    stocks = []
    for _, row in df.iterrows():
        raw_code = str(row['代码']).strip()
        name = str(row['名称']).strip()
        # 提取6位纯数字代码（去掉 sh/sz/bj 前缀）
        code = raw_code[-6:] if len(raw_code) > 6 else raw_code
        if code and name and len(code) == 6 and code.isdigit():
            stocks.append({'code': code, 'name': name})

    print(f'AKShare 返回: {len(stocks)} 只 A 股', file=sys.stderr)

    # 输出 JSON 到 stdout
    print(json.dumps(stocks, ensure_ascii=False))

except Exception as e:
    print(f'AKShare 拉取失败: {e}', file=sys.stderr)
    sys.exit(1)
