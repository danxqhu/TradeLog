#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
每日追资金 —— 板块资金流 / 成分股 / 日线打分脚本（数据源：AKShare·东方财富口径）

用法：
  python3 fetch_money_chase.py --action sectors
  python3 fetch_money_chase.py --action constituents --sectors "机器人,军工,数据要素"
  python3 fetch_money_chase.py --action score --sectors "机器人,军工" \
          --symbols "600000:机器人,000001:人工自选" --out /app/data/mc_result_12.json

约定（重要）：
  1. 每个外部接口每次运行【只调用 1 次，绝不自动重试】。失败即记录中文错误，
     关键接口失败直接退出（exit 1），由前端弹窗告知人工，人工自行决定何时重试。
  2. 所有阈值来自 --params-file（后端下发的生效参数），本文件不含业务阈值默认值以外的硬编码。
     参数文件缺失时退回内置默认，保证脚本可独立调试。
  3. 进度写 stderr：`[PROGRESS] 已处理 总数 阶段文案`
  4. score 动作把完整结果写入 --out 文件，stdout 只输出摘要（结果含 K 线数据，体积较大）
  5. 盘中运行：用实时快照合成「当日未收盘 K 线」，量能按已交易时间折算成全天估算量

输出结构见文件末尾 OUTPUT SCHEMA。
"""
import argparse
import json
import math
import sys
import time
import warnings
from datetime import datetime, timedelta, timezone

warnings.filterwarnings('ignore')

try:
    import akshare as ak
except ImportError:
    print(json.dumps({"ok": False, "error": "AKShare 未安装，请执行 pip3 install akshare",
                      "error_detail": "ImportError: akshare"}, ensure_ascii=False))
    sys.exit(1)

try:
    import numpy as np
    import pandas as pd
except ImportError:
    print(json.dumps({"ok": False, "error": "pandas / numpy 未安装，无法计算技术指标",
                      "error_detail": "ImportError: pandas|numpy"}, ensure_ascii=False))
    sys.exit(1)

CST = timezone(timedelta(hours=8))
HIST_START_YEARS = 2          # 拉取日线回看年数（保证 120 根 + 指标预热）
TOTAL_TRADING_MIN = 240       # A 股全天交易分钟（9:30-11:30 + 13:00-15:00）

# 内置默认参数：仅用于脚本独立调试，正常运行时会被后端下发的生效参数整体覆盖
DEFAULT_PARAMS = {
    "top_sectors": 3, "sector_display_count": 5, "sector_source": "eastmoney",
    "max_candidates_per_run": 120, "kline_days": 120, "min_bars_required": 60,
    "n_day_high_low": 20, "dow_segments": 3, "n_adx": 14, "n_adx_smooth": 6,
    "adx_trend_threshold": 25, "ma_short": 5, "ma_mid": 20, "ma_long": 30,
    "valid_break_ma20_pct": 2.0, "fib_lookback": 60, "fib_near_pct": 3.0,
    "chip_pressure_dist_min_pct": 5.0, "chip_probe_limit": 20, "vol_ma_period": 20,
    "vol_expand_ratio": 1.1, "vol_start_ratio": 1.2, "vol_shrink_ratio": 0.7,
    "b_weak_vol_ratio": 0.8, "extreme_vol_ratio": 3.5, "stale_high_vol_ratio": 2.0,
    "stale_high_max_pct": 1.0, "low_streak_window": 10, "low_streak_tolerance": 3.0,
    "retract_min": 20.0, "retrace_lookback": 60, "b_dist_to_low_max": 15.0,
    "b_fresh_break_days": 3, "b_momentum_window": 5, "b_momentum_max_drop": 6.0,
    "b_new_low_window": 5, "b_new_low_count": 3, "b_lift_min_pct": 2.0,
    "b_r1_new_low_window": 10, "b_r1_new_low_min_count": 2, "b_r1_down_vol_ratio": 1.2,
    "divergence_lookback": 60, "m_head_tolerance_pct": 3.0, "swing_prominence_pct": 5.0,
    "a_max_today_pct": 7.0, "b_max_today_pct": 5.0, "b_fresh_break_drop_pct": 8.0,
    "sector_ebb_check": True, "a_overextend_ma20_pct": 15.0, "a_overextend_enabled": False,
    "filter_st": True, "filter_new_stock": True, "filter_bse": False,
    "filter_star": False, "filter_cyb": False,
    "manual_score_per_item": 1, "manual_score_max": 4,
    "highlight_a_total": 7, "highlight_b_total": 6,
    "request_interval_sec": 0.25, "single_call_timeout_sec": 20,
    # ---- 招财进宝多模块打分（fp_*）：仅当后端下发 fp_compute=true 时计算，追资金路径不开启、零开销
    #      默认值与 config/fortune_criteria.json 的 module_params 一致（真源在那边，这里只供脚本独立调试）
    "fp_compute": False,
    "fp_window_break": 20, "fp_vol_break_ratio": 1.1, "fp_vol_shrink_ratio": 0.7,
    "fp_pullback_days": 2, "fp_stall_vol_ratio": 1.2, "fp_stall_max_pct": 0.5,
    "fp_ma_short": 20, "fp_ma_long": 30, "fp_ma_slope_bars": 1,
    "fp_dmi_period": 14, "fp_adx_strong": 40, "fp_adx_trend": 25, "fp_adx_weak": 20,
    "fp_fib_lookback": 60, "fp_fib_ratios": [0.236, 0.382, 0.5, 0.618], "fp_fib_tolerance": 2.0,
    "fp_box_window": 20, "fp_box_min_amp_pct": 4.0, "fp_box_retest_tolerance_pct": 1.0,
    "fp_candle_shadow_body_ratio": 2, "fp_candle_upper_body_ratio": 0.3,
    "fp_candle_body_pos_min": 0.6, "fp_candle_trend_lookback": 5,
    # ---- 招财进宝衰竭止盈 W1~W8（wp_*）：仅当后端下发 fp_sell_compute=true 时计算，追资金路径不开启
    #      默认值与 config/fortune_criteria.json 的 sell_params 一致（真源在那边，这里只供脚本独立调试）
    "fp_sell_compute": False,
    "wp_ma_ref": 20, "wp_dev_light": 5, "wp_dev_mid": 8, "wp_dev_severe": 12,
    "wp_valid_break_pct": 2, "wp_swing_window": 3, "wp_struct_lookback": 60,
    "wp_hh_shrink_ratio": 0.5, "wp_hh_shrink_min_pct": 2, "wp_vol_div_ratio": 0.8,
    "wp_high_zone_pct": 3, "wp_stall_vol_mult": 1.5, "wp_stall_pct_max": 0.5,
    "wp_turnover_min": 8, "wp_shadow_body_mult": 2, "wp_shadow_drop_pct": 3,
    "wp_shadow_vol_mult": 1.5, "wp_fib_lookback": 60, "wp_fib_ext_ratios": [1.618, 2.618],
    "wp_fib_ext_tolerance": 2, "wp_fib_min_amp_pct": 20, "wp_fib_stall_bars": 3,
    "wp_ext2_fail_min": 2, "wp_box_window": 20, "wp_box_min_amp_pct": 4,
    "wp_box_touch_min": 3, "wp_fake_break_days": 5, "wp_fake_back_pct": 1,
    "wp_div_lookback": 60, "wp_gain_period": 60, "wp_gain_range1": [80, 150],
    "wp_gain_range2": 150,
}

P = dict(DEFAULT_PARAMS)   # 运行时生效参数


# ============================================================ 基础工具

def pget(key, fallback=None):
    """读取生效参数（缺失退回内置默认）"""
    v = P.get(key, DEFAULT_PARAMS.get(key, fallback))
    return fallback if v is None else v


def num(v, default=None):
    """安全数值化：NaN/Inf/空 → default"""
    try:
        if v is None:
            return default
        f = float(v)
        if math.isnan(f) or math.isinf(f):
            return default
        return f
    except (TypeError, ValueError):
        return default


def rnd(v, n=3):
    f = num(v)
    return None if f is None else round(f, n)


def clean(obj):
    """递归清理为 JSON 可序列化（numpy 类型 / NaN / Timestamp）"""
    if isinstance(obj, dict):
        return {k: clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v) for v in obj]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        f = float(obj)
        return None if (math.isnan(f) or math.isinf(f)) else f
    if isinstance(obj, (pd.Timestamp, datetime)):
        return obj.strftime('%Y-%m-%d')
    if isinstance(obj, (bool, np.bool_)):
        return bool(obj)
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    return obj


def emit_error(action, msg, detail=''):
    """结构化错误输出（前端弹窗直接展示 msg，detail 供排查）"""
    print(json.dumps({
        "ok": False,
        "action": action,
        "error": msg,
        "error_detail": str(detail)[:500],
    }, ensure_ascii=False))
    sys.exit(1)


def progress(done, total, stage):
    print(f"[PROGRESS] {done} {total} {stage}", file=sys.stderr, flush=True)


def pace():
    time.sleep(pget("request_interval_sec", 0.25))


def pick_col(df, *keys):
    """按关键词模糊定位列名（AKShare 不同版本字段会变，禁止硬编码位置）"""
    for c in df.columns:
        name = str(c)
        for k in keys:
            if k in name:
                return c
    return None


def safe_call(label, fn, *args, **kwargs):
    """
    单次调用封装：不重试、不循环。
    返回 (data, None) 成功 / (None, {label, error}) 失败
    """
    try:
        data = fn(*args, **kwargs)
        if data is None:
            return None, {"label": label, "error": f"{label}：接口返回空数据"}
        if isinstance(data, pd.DataFrame) and data.empty:
            return None, {"label": label, "error": f"{label}：接口返回空表（可能板块名称不匹配或数据源未发布）"}
        return data, None
    except Exception as exc:  # noqa - 有意捕获全部异常转成人工可读错误
        return None, {"label": label, "error": f"{label}：调用失败（{type(exc).__name__}）", "raw": str(exc)}


def parse_now(text):
    """解析后端下发的北京时间（ISO 带 +08:00），缺省用本机时间"""
    if text:
        try:
            dt = datetime.fromisoformat(text)
            return dt.astimezone(CST) if dt.tzinfo else dt.replace(tzinfo=CST)
        except ValueError:
            pass
    return datetime.now(CST)


def trading_minutes(now):
    """
    计算「已交易分钟」与量能折算系数。
    盘前(9:30 前) → 0；收盘后(15:00 及以后) → 240（完整，不折算）
    """
    t = now.hour * 60 + now.minute
    am_open, am_close = 9 * 60 + 30, 11 * 60 + 30
    pm_open, pm_close = 13 * 60, 15 * 60
    if t < am_open:
        elapsed = 0
    elif t <= am_close:
        elapsed = t - am_open
    elif t < pm_open:
        elapsed = 120
    elif t <= pm_close:
        elapsed = 120 + (t - pm_open)
    else:
        elapsed = TOTAL_TRADING_MIN
    scale = elapsed / TOTAL_TRADING_MIN if 0 < elapsed < TOTAL_TRADING_MIN else 1.0
    return elapsed, scale


def bj_date_str(dt):
    return dt.strftime('%Y-%m-%d')


# ============================================================ 数据获取

# 东财 push2 直连：ak.stock_sector_fund_flow_rank 会按 total/100 分页（本次实测 total=496 → 5 次请求），
# 取前 N 名完全不需要全量，故只发 1 次请求、按 field id 直接取值（不依赖任何位置改名，版本升级不会错列）。
# UA 必须用下述旧版 Chrome：实测现代 UA + Referer 会被东财直接断开连接。
EM_HEADERS = {"User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                             "(KHTML, like Gecko) Chrome/81.0.4044.138 Safari/537.36")}
EM_CLIST_URL = "https://push2.eastmoney.com/api/qt/clist/get"


def em_sector_fund(sector_type="行业资金流", indicator="今日"):
    """
    行业/概念/地区板块资金流排名（单次请求）
    返回 (rows, err)；rows=[{code,name,price,pct,net_yi,net_pct}]，已按指标降序
    字段含义（实测）：f12=板块代码 f14=名称 f2=最新价 f3=涨跌幅
                    f62=今日主力净流入净额(元) f184=今日主力净流入净占比(%)
                    f164=5日主力净流入净额(元) f174=10日主力净流入净额(元)
    """
    fs_map = {"行业资金流": "m:90 t:2", "概念资金流": "m:90 t:3", "地区资金流": "m:90 t:1"}
    fid_map = {"今日": ("f62", "f184"), "5日": ("f164", None), "10日": ("f174", None)}
    net_field, pct_field = fid_map[indicator]
    params = {
        "pn": "1", "pz": "100", "po": "1", "np": "1",
        "ut": "b2884a393a59ad64002292a3e90d46a5", "fltt": "2", "invt": "2",
        "fid0": net_field, "fs": fs_map.get(sector_type, "m:90 t:2"), "stat": indicator.replace("日", ""),
        "fields": ",".join([x for x in ('f12', 'f14', 'f2', 'f3', net_field, pct_field) if x]),
        "rt": "52975239", "_": int(time.time() * 1000),
    }
    try:
        import requests
        r = requests.get(EM_CLIST_URL, params=params, headers=EM_HEADERS, timeout=float(pget('single_call_timeout_sec', 20)))
        diff = ((r.json() or {}).get("data") or {}).get("diff") or []
    except Exception as exc:  # noqa
        return None, {"label": f"板块资金流·{indicator}", "error": f"东财板块资金流接口调用失败（{type(exc).__name__}）", "raw": str(exc)}
    if not diff:
        return None, {"label": f"板块资金流·{indicator}", "error": f"东财板块资金流接口返回空数据（HTTP {r.status_code}）"}
    rows = []
    for it in diff:
        if not isinstance(it, dict):
            continue
        rows.append({
            "code": str(it.get("f12") or '').strip(),
            "name": str(it.get("f14") or '').strip(),
            "price": num(it.get("f2")),
            "pct_change": num(it.get("f3")),
            "net_inflow_yi": rnd((num(it.get(net_field)) or 0) / 1e8, 2),
            "net_inflow_pct": num(it.get(pct_field)) if pct_field else None,
        })
    rows.sort(key=lambda x: (x["net_inflow_yi"] is None, -(x["net_inflow_yi"] or 0)))
    return rows, None


def fetch_sector_flow(now, soft=False):
    """
    行业板块资金流：今日（1 次）+ 5 日（1 次），共 2 次请求，不重试
    返回 [{name, code, pct_change, net_inflow_yi, net_inflow_pct, net_5d_yi, avg_5d_yi, ebb}]
    soft=True：今日也取不到时不整体中止（页面已经给出候选清单的场景，板块资金流只是加分项），
               只把原因记进 meta.warnings，板块相关判定按数据缺失计，不影响逐只打分与入库
    """
    rows, err = em_sector_fund("行业资金流", "今日")
    if err:
        if soft:
            return [], {"sector_flow_error": err["error"], "sector_5d_error": None}
        emit_error("sectors",
                   "板块资金流接口本次未返回数据（可能是东财临时限流或网络异常）。脚本已按规则停止，未做重试。"
                   "你可以稍后点「重试」，或直接在页面手动输入 3 个板块名。",
                   err.get("raw") or err["error"])

    for r in rows:
        r.setdefault("net_5d_yi", None)
        r.setdefault("avg_5d_yi", None)
        r.setdefault("ebb", None)

    # 5 日资金流（人工判断「脉冲一日游」+ 红线 B_R3 板块退潮）：失败不致命，仅记警告
    pace()
    d5, err5 = em_sector_fund("行业资金流", "5日")
    if err5 is None and d5:
        m5 = {x["name"]: x["net_inflow_yi"] for x in d5}
        for row in rows:
            total5 = m5.get(row["name"])
            if total5 is not None:
                row["net_5d_yi"] = total5
                row["avg_5d_yi"] = rnd(total5 / 5, 2)
                if row["net_inflow_yi"] is not None:
                    row["ebb"] = bool(row["net_inflow_yi"] < (row["avg_5d_yi"] or 0))
        err5 = None
    return rows, {"sector_5d_error": (err5 or {}).get("error") if err5 else None}


def fetch_spot_map(now):
    """全市场实时快照（1 次调用）→ {code: {price,pct,open,high,low,volume,amount,turnover_ratio,last_date}}"""
    df, err = safe_call("全市场实时快照", ak.stock_zh_a_spot_em)
    if err:
        emit_error("score", "实时行情快照接口未返回数据，无法按运行当下的价格打分。可稍后点「重试」。",
                   err.get("raw") or err["error"])
    c = {k: pick_col(df, *ks) for k, ks in {
        'code': ('代码',), 'name': ('名称',), 'price': ('最新价', '现价'), 'pct': ('涨跌幅',),
        'open': ('今开',), 'high': ('最高',), 'low': ('最低',), 'vol': ('成交量',),
        'amount': ('成交额',), 'turnover': ('换手率',), 'prev_close': ('昨收',),
        'vol_ratio': ('量比',),
    }.items()}
    if not c['code'] or not c['price']:
        emit_error("score", "实时行情接口字段有变化（缺少 代码/最新价 列），脚本已停止，未做重试。",
                   "columns=" + ",".join([str(x) for x in df.columns][:20]))

    out = {}
    for _, r in df.iterrows():
        code = str(r[c['code']]).strip()
        if len(code) != 6 or not code.isdigit():
            continue
        out[code] = {
            "name": str(r[c['name']]).strip() if c['name'] else '',
            "price": num(r[c['price']]),
            "pct": num(r[c['pct']]) if c['pct'] else None,
            "open": num(r[c['open']]) if c['open'] else None,
            "high": num(r[c['high']]) if c['high'] else None,
            "low": num(r[c['low']]) if c['low'] else None,
            "volume": num(r[c['vol']]) if c['vol'] else None,   # 手
            "amount": num(r[c['amount']]) if c['amount'] else None,
            "turnover": num(r[c['turnover']]) if c['turnover'] else None,
            "prev_close": num(r[c['prev_close']]) if c['prev_close'] else None,
            "vol_ratio": num(r[c['vol_ratio']]) if c['vol_ratio'] else None,
        }
    return out


def fetch_industry_boards():
    """东财行业板块名清单（1 次调用），用于板块名模糊匹配"""
    pace()
    df, err = safe_call("行业板块清单", ak.stock_board_industry_name_em)
    if err:
        return [], err
    nc = pick_col(df, '板块名称', '名称')
    return ([str(x).strip() for x in df[nc].tolist()], None) if nc else ([], {"error": "板块清单缺少名称列"})


def fuzzy_match_sector(name, boards):
    """板块名模糊匹配：精确 > 包含 > 被包含；返回候选列表（最多 5 个，绝不静默丢弃）"""
    name = (name or '').strip()
    if not name:
        return []
    if name in boards:
        return [name]
    exact = [b for b in boards if b == name.replace('概念', '')]
    if exact:
        return exact
    contains = [b for b in boards if name in b or b in name]
    if contains:
        return contains[:5]
    # 字符重合度兜底
    scored = []
    for b in boards:
        inter = len(set(name) & set(b))
        if inter >= 2:
            scored.append((inter / max(len(set(name)), len(set(b))), b))
    scored.sort(reverse=True)
    return [b for _, b in scored[:5]]


def fetch_constituents(sector_name):
    """板块成分股（1 次调用）"""
    return safe_call(f"板块成分[{sector_name}]", ak.stock_board_industry_cons_em, symbol=sector_name)


def fetch_daily(symbol, end_date):
    """前复权日线（1 次调用）。列名按真实返回动态适配，不做位置假设。"""
    start = (datetime.strptime(end_date, '%Y-%m-%d') - timedelta(days=int(365 * HIST_START_YEARS))).strftime('%Y%m%d')
    return safe_call(f"日线[{symbol}]", ak.stock_zh_a_hist, symbol=symbol, period="daily",
                     start_date=start, end_date=end_date.replace('-', ''), adjust="qfq")


def normalize_daily(df):
    """AKShare 日线 → 标准列 date/open/high/low/close/volume/amount/turnover（单位：成交量=手）"""
    cols = {
        'date': pick_col(df, '日期'), 'open': pick_col(df, '开盘'), 'close': pick_col(df, '收盘'),
        'high': pick_col(df, '最高'), 'low': pick_col(df, '最低'), 'volume': pick_col(df, '成交量'),
        'amount': pick_col(df, '成交额'), 'turnover': pick_col(df, '换手率'), 'pct': pick_col(df, '涨跌幅'),
    }
    missing = [k for k in ('date', 'open', 'close', 'high', 'low', 'volume') if not cols[k]]
    if missing:
        return None, f"日线字段缺少 {','.join(missing)}"
    out = pd.DataFrame()
    out['date'] = pd.to_datetime(df[cols['date']]).dt.strftime('%Y-%m-%d')
    for k in ('open', 'close', 'high', 'low', 'volume', 'amount', 'turnover', 'pct'):
        out[k] = pd.to_numeric(df[cols[k]], errors='coerce') if cols[k] else np.nan
    out = out.dropna(subset=['date', 'close', 'high', 'low']).sort_values('date').reset_index(drop=True)
    return (out, None) if not out.empty else (None, "日线为空")


# ============================================================ 新浪数据源（日线 / 快照 / 分时）
#
# 规则判定不绑定 AKShare（东财）：逐只日线与实时价改走新浪，请求次数不变（每股 1 次，同样不重试），
# 但域名不同（money.finance.sina.com.cn / hq.sinajs.cn），避免把全部请求压在被限流的东财上。
# 单位对齐：新浪成交量是「股」，东财日线成交量是「手」→ 统一除以 100 存成「手」，不然量比会差 100 倍。

SINA_HEADERS = {
    'Referer': 'https://finance.sina.com.cn',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
}
# money 域名给日线/5 分钟（但 scale=1 会返回 null），quotes 域名才给 1 分钟分时
SINA_KLINE_URLS = {
    'money': 'http://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData',
    'quotes': 'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData',
}


def sina_symbol(code):
    """6 位代码 → 新浪带市场前缀代码"""
    code = str(code).strip()
    if code[:2] in ('sh', 'sz', 'bj'):
        return code
    if code[0] in ('6', '9'):
        return 'sh' + code
    if code[0] in ('0', '1', '2', '3'):
        return 'sz' + code
    return 'bj' + code


def sina_kline(code, scale=240, datalen=120, host='money'):
    """新浪 K 线（单次请求，不重试）→ (list[dict], None) / (None, err)"""
    try:
        import requests
    except ImportError:
        return None, {"label": "新浪K线", "error": "环境缺少 requests 库，无法请求新浪 K 线"}
    url = f"{SINA_KLINE_URLS[host]}?symbol={sina_symbol(code)}&scale={scale}&ma=no&datalen={datalen}"
    try:
        r = requests.get(url, headers=SINA_HEADERS, timeout=float(pget('single_call_timeout_sec', 20)))
        if r.status_code != 200:
            return None, {"label": f"新浪K线[{code}]", "error": f"新浪 K 线接口返回 HTTP {r.status_code}", "raw": r.text[:200]}
        data = json.loads(r.text)
        if not isinstance(data, list) or not data:
            return None, {"label": f"新浪K线[{code}]", "error": "新浪 K 线接口返回空数据（代码可能有误、退市或停牌）"}
        return data, None
    except Exception as exc:  # noqa - 单次失败转中文错误，不重试
        return None, {"label": f"新浪K线[{code}]", "error": f"新浪 K 线调用失败（{type(exc).__name__}）", "raw": str(exc)}


def sina_daily(code, datalen=180):
    """新浪日 K → normalize_daily 同款标准列（涨跌幅按昨收自算，换手率/成交额新浪不给→ NaN/0）"""
    data, err = sina_kline(code, scale=240, datalen=datalen)
    if err:
        return None, err
    rows = [{
        'date': str(it.get('day') or '')[:10],
        'open': num(it.get('open')), 'close': num(it.get('close')),
        'high': num(it.get('high')), 'low': num(it.get('low')),
        'volume': (num(it.get('volume')) or 0) / 100.0,
        'amount': np.nan, 'turnover': np.nan,
    } for it in data]
    out = pd.DataFrame(rows)
    out = out.dropna(subset=['date', 'close', 'high', 'low']).sort_values('date').reset_index(drop=True)
    if out.empty:
        return None, "新浪日线解析后为空"
    out['pct'] = (out['close'] / out['close'].shift(1) - 1) * 100
    return out, None


def sina_spot(codes):
    """
    新浪实时快照：每 50 只 1 次请求（不逐只请求，也不重试）
    → ({code: {name,price,pct,open,high,low,volume,amount,last_date,last_time}}, [没返回数据的 code])
    """
    out, missing = {}, []
    codes = [str(c).strip() for c in (codes or []) if str(c).strip()]
    try:
        import requests
    except ImportError:
        return {}, codes
    for i in range(0, len(codes), 50):
        chunk = codes[i:i + 50]
        url = 'http://hq.sinajs.cn/list=' + ','.join(sina_symbol(c) for c in chunk)
        try:
            r = requests.get(url, headers=SINA_HEADERS, timeout=float(pget('single_call_timeout_sec', 20)))
            r.encoding = 'gbk'
            text = r.text
        except Exception as exc:  # noqa
            print(f"[WARN] 新浪快照失败（{type(exc).__name__}）：{exc}", file=sys.stderr)
            missing.extend(chunk)
            continue
        got = set()
        for line in text.split('\n'):
            if '="' not in line:
                continue
            head, _, body = line.partition('="')
            sina_code = head.strip().split('_')[-1]
            code = sina_code[-6:]
            f = body.rstrip('";').split(',')
            if len(f) < 32:
                continue
            price, prev, vol_shou = num(f[3]), num(f[2]), num(f[8])
            if not price or not prev:
                continue
            out[code] = {
                'name': f[0], 'open': num(f[1]), 'prev_close': prev, 'price': price,
                'high': num(f[4]), 'low': num(f[5]),
                'volume': (vol_shou or 0) / 100.0,   # 股 → 手
                'amount': num(f[9]), 'turnover': None,
                'pct': (price / prev - 1) * 100 if prev else None,
                'last_date': f[30], 'last_time': f[31],
            }
            got.add(code)
        missing.extend(c for c in chunk if c not in got)
        if i + 50 < len(codes):
            pace()
    return out, missing


def sina_minutes(code):
    """
    今日分时（1 次请求，不重试）→ (分时点, 昨收, 周期分钟, 分时日期)
    先试 quotes 域名的 1 分钟；拿不到就用 money 域名的 5 分钟（同样只取当日）
    非交易日/停牌时返回最近一个有数据的交易日，由前端标清日期
    """
    for host, scale, dl in (('quotes', 1, 250), ('money', 5, 60)):
        data, err = sina_kline(code, scale=scale, datalen=dl, host=host)
        if err or not data:
            continue
        days = sorted({str(it.get('day') or '')[:10] for it in data if it.get('day')})
        if not days:
            continue
        last_day = days[-1]
        prev_day = days[-2] if len(days) > 1 else None
        prev_close = None
        if prev_day:
            tail = [it for it in data if str(it.get('day') or '')[:10] == prev_day]
            if tail:
                prev_close = num(tail[-1].get('close'))
        cum_pv, cum_v, pts = 0.0, 0.0, []
        for it in data:
            if str(it.get('day') or '')[:10] != last_day:
                continue
            p, v = num(it.get('close')), (num(it.get('volume')) or 0)
            if p is None:
                continue
            cum_pv += p * v
            cum_v += v
            pts.append({
                't': str(it.get('day') or '')[11:16], 'p': rnd(p, 3), 'v': rnd(v / 100.0, 0),
                'avg': rnd(cum_pv / cum_v, 3) if cum_v else rnd(p, 3),
                'pct': rnd((p / prev_close - 1) * 100, 2) if prev_close else None,
            })
        if pts:
            return pts, prev_close, scale, last_day
    return None, None, None, None


def hist_bars(end_date):
    """
    新浪日线只给「最近 N 根」，要做历史切片就得先多要一点。
    按 end_date 距今的自然日数折算成交易日数（含假余量），最多 900 根。
    """
    try:
        d = datetime.strptime(str(end_date)[:10], '%Y-%m-%d')
    except Exception:
        return 0
    gap = (datetime.now() - d).days
    return min(900, int(gap * 5 / 7) + 10) if gap > 10 else 0


def sina_minutes_day(code, want_date, fine_first=True):
    """
    指定交易日的分时点（不重试）→ (info, None) / (None, 中文错误)
    info = {'pts': [(HH:MM, 价格, 成交量手)], 'scale': 周期分钟, 'prev_close': 昨收, 'days': [可取日期]}
    新浪 1 分钟只给最近 1 个交易日（精度高），5 分钟 datalen=330 约给最近 7 个交易日；
    两者都覆盖不到目标日期时报错，由上层明确提示“这一天只能取收盘快照”
    （不静默降级，免得你以为拿到的是 10:00 的状态）。
    """
    hosts = (('quotes', 1, 250), ('money', 5, 330)) if fine_first else (('money', 5, 330), ('quotes', 1, 250))
    seen_days, last_err, thin = [], None, None
    for host, scale, dl in hosts:
        data, err = sina_kline(code, scale=scale, datalen=dl, host=host)
        if err:
            last_err = err
            continue
        by_day = {}
        for it in data:
            day, t = str(it.get('day') or '')[:10], str(it.get('day') or '')[11:16]
            p, v = num(it.get('close')), num(it.get('volume'))
            if not day or p is None:
                continue
            by_day.setdefault(day, []).append((t, p, rnd((v or 0) / 100.0, 0)))
        seen_days = sorted(set(seen_days) | set(by_day))
        pts = sorted(by_day.get(want_date) or [], key=lambda x: x[0])
        # 1 分钟只给最近 250 个点，上一交易日往往只余尾盘几分钟；连开盘都没覆盖到就不能用来切片，得换下一个数据源
        if pts and pts[0][0] <= '09:40':
            idx = seen_days.index(want_date) if want_date in seen_days else -1
            prev_close = by_day[seen_days[idx - 1]][-1][1] if idx > 0 and seen_days[idx - 1] in by_day else None
            return {'pts': pts, 'scale': scale, 'prev_close': prev_close, 'days': seen_days}, None
        if pts:
            thin = pts
    rng = f"{seen_days[0]} ~ {seen_days[-1]}" if seen_days else "本次未取到任何分时数据"
    if thin:
        return None, {"error": f"{want_date} 的分时只残下 {len(thin)} 个点（从 {thin[0][0]} 开始），没覆盖到开盘，无法按时刻切片（可取范围：{rng}）。这一天请用收盘快照",
                      "raw": (last_err or {}).get('error', '')}
    return None, {"error": f"分时数据里没有 {want_date} 这一天的盘中数据（新浪分时可取范围：{rng}，约最近 7 个交易日），这一天请用收盘快照",
                  "raw": (last_err or {}).get('error', '')}


def build_asof_spot(pts_info, want_date, asof_time, day_open, prev_fb):
    """
    用分时点还原「截至 asof_time 的当日临时 K」（盘中快照用）
    → (spot, 分时展示点) / (None, 中文说明)；分时量已除 100，单位与日线一致（手）
    """
    cut = [x for x in pts_info['pts'] if x[0] <= asof_time]
    if not cut:
        return None, f"{want_date} 在 {asof_time} 之前没有分时成交（未开盘或停牌）"
    prices = [x[1] for x in cut]
    prev = pts_info.get('prev_close') or prev_fb
    spot = {
        'name': '', 'open': day_open or prices[0], 'high': max(prices), 'low': min(prices),
        'price': prices[-1], 'volume': rnd(sum(x[2] for x in cut), 0), 'amount': 0, 'turnover': None,
        'pct': rnd((prices[-1] / prev - 1) * 100, 2) if prev else None,
        'last_date': want_date, 'last_time': cut[-1][0],
    }
    cum_pv, cum_v, mpts = 0.0, 0.0, []
    for t, p, v in cut:
        cum_pv += p * v
        cum_v += v
        mpts.append({'t': t, 'p': rnd(p, 3), 'v': rnd(v, 0),
                     'avg': rnd(cum_pv / cum_v, 3) if cum_v else rnd(p, 3),
                     'pct': rnd((p / prev - 1) * 100, 2) if prev else None})
    return spot, mpts


def load_daily(code, end_date, source='sina'):
    """
    按数据源取日线并归一到标准列（只请求 1 次，不重试）
    sina 失败时才回落东财（再多 1 次），两边都挂才报错
    快照/补历史时按 end_date 距今的天数多要根数，不然切片后不够 180 根
    """
    sina_err = None
    if source == 'sina':
        df, sina_err = sina_daily(code, int(pget('kline_days', 120)) + 60 + hist_bars(end_date))
        if sina_err is None:
            return df, None
    raw, err = fetch_daily(code, end_date)
    if err:
        if sina_err:
            return None, {"label": f"日线[{code}]",
                          "error": f"新浪日线失败（{sina_err['error']}），东财日线也未返回：{err['error']}",
                          "raw": (sina_err.get('raw') or '') + ' | ' + (err.get('raw') or '')}
        return None, err
    return normalize_daily(raw)


# ============================================================ 技术指标

def add_ma(df, periods):
    for p in periods:
        df[f'ma{p}'] = df['close'].rolling(int(p)).mean()
    return df


def calc_adx(df, n, m):
    """Wilder 风格 ADX / PDI / MDI（滚动求和，与原实现一致）"""
    high, low, close = df['high'], df['low'], df['close']
    tr = pd.concat([high - low, (high - close.shift(1)).abs(), (low - close.shift(1)).abs()], axis=1).max(axis=1)
    tr_sum = tr.rolling(int(n)).sum()
    hd = high - high.shift(1)
    ld = low.shift(1) - low
    dmp = pd.Series(np.where((hd > 0) & (hd > ld), hd, 0.0), index=df.index)
    dmm = pd.Series(np.where((ld > 0) & (ld > hd), ld, 0.0), index=df.index)
    pdi = dmp.rolling(int(n)).sum() / (tr_sum + 1e-8) * 100
    mdi = dmm.rolling(int(n)).sum() / (tr_sum + 1e-8) * 100
    dx = (pdi - mdi).abs() / (pdi + mdi + 1e-8) * 100
    adx = dx.rolling(int(m)).mean()
    df['pdi'], df['mdi'], df['adx'] = pdi, mdi, adx
    return df


def calc_macd(df, fast=12, slow=26, signal=9):
    ema_fast = df['close'].ewm(span=fast, adjust=False).mean()
    ema_slow = df['close'].ewm(span=slow, adjust=False).mean()
    dif = ema_fast - ema_slow
    dea = dif.ewm(span=signal, adjust=False).mean()
    df['dif'], df['dea'], df['macd'] = dif, dea, (dif - dea) * 2
    return df


def find_swings(df, window=3):
    """局部高低点（±window 内极值），用于背离与双顶"""
    highs, lows = [], []
    h, l = df['high'].values, df['low'].values
    for i in range(window, len(df) - window):
        seg_h = h[i - window:i + window + 1]
        seg_l = l[i - window:i + window + 1]
        if h[i] == seg_h.max() and (seg_h > h[i]).sum() == 0 and (seg_h == h[i]).sum() == 1:
            highs.append(i)
        if l[i] == seg_l.min() and (seg_l < l[i]).sum() == 0 and (seg_l == l[i]).sum() == 1:
            lows.append(i)
    return highs, lows


def dow_trend(df, window, segments):
    """
    道氏高低点判定：窗口切 segments 段，比较各段最高/最低是否依次抬升
    返回 (trend, marks)  marks=[{seg,highDate,high,lowDate,low}]
    """
    sub = df.tail(int(window))
    if len(sub) < int(window):
        return 'SHAKE', []
    seg_len = max(1, len(sub) // int(segments))
    marks, hs, ls = [], [], []
    for i in range(int(segments)):
        chunk = sub.iloc[i * seg_len:(i + 1) * seg_len] if i < int(segments) - 1 else sub.iloc[i * seg_len:]
        if chunk.empty:
            return 'SHAKE', []
        hi_idx = chunk['high'].idxmax()
        lo_idx = chunk['low'].idxmin()
        hs.append(float(df.loc[hi_idx, 'high']))
        ls.append(float(df.loc[lo_idx, 'low']))
        marks.append({
            "seg": i + 1,
            "high": round(float(df.loc[hi_idx, 'high']), 3),
            "high_date": str(df.loc[hi_idx, 'date']),
            "low": round(float(df.loc[lo_idx, 'low']), 3),
            "low_date": str(df.loc[lo_idx, 'date']),
        })
    up = all(hs[i] < hs[i + 1] for i in range(len(hs) - 1)) and all(ls[i] < ls[i + 1] for i in range(len(ls) - 1))
    down = all(hs[i] > hs[i + 1] for i in range(len(hs) - 1)) and all(ls[i] > ls[i + 1] for i in range(len(ls) - 1))
    return ('UP' if up else 'DOWN' if down else 'SHAKE'), marks


def calc_fib(df, lookback, near_pct):
    sub = df.tail(int(lookback))
    h = float(sub['high'].max())
    l = float(sub['low'].min())
    rng = h - l
    price = float(df['close'].iloc[-1])
    levels = {
        "fib382": rnd(h - rng * 0.382, 3),
        "fib500": rnd(h - rng * 0.5, 3),
        "fib618": rnd(h - rng * 0.618, 3),
        "high": rnd(h, 3), "low": rnd(l, 3),
    }
    near = None
    for k in ('fib382', 'fib500', 'fib618'):
        v = levels[k]
        if v and price and abs(price - v) / price * 100 <= float(near_pct):
            near = k
            break
    levels["near"] = near
    return (price is not None and near is not None), levels


def detect_top_divergence(df, lookback):
    """
    顶背离（红线 A_R1 前半）：窗口内两段价格新高，后一段价更高但 DIF 更低
    返回 (是否背离, 说明, 连线点 marks)
    """
    sub = df.tail(int(lookback)).reset_index(drop=True)
    if len(sub) < 20 or 'dif' not in sub.columns:
        return False, "数据不足，未做背离判定", []
    highs, _ = find_swings(sub, window=3)
    highs = [i for i in highs if num(sub.loc[i, 'dif']) is not None]
    if len(highs) < 2:
        return False, "未形成两段可比新高", []
    h_vals = [float(sub.loc[i, 'high']) for i in highs]
    order = sorted(range(len(highs)), key=lambda k: h_vals[k], reverse=True)[:2]
    order.sort()
    a, b = highs[order[0]], highs[order[1]]
    if not (sub.loc[b, 'high'] > sub.loc[a, 'high']):
        return False, "后一高点未创新高，无背离", []
    dif_a, dif_b = float(sub.loc[a, 'dif']), float(sub.loc[b, 'dif'])
    marks = [
        {"date": str(sub.loc[a, 'date']), "price": rnd(sub.loc[a, 'high'], 3), "kind": "div_high", "dif": rnd(dif_a, 4)},
        {"date": str(sub.loc[b, 'date']), "price": rnd(sub.loc[b, 'high'], 3), "kind": "div_high", "dif": rnd(dif_b, 4)},
    ]
    if dif_b < dif_a:
        return True, f"价创新高 {sub.loc[b,'high']:.2f} > {sub.loc[a,'high']:.2f}，但 DIF {dif_b:.3f} < {dif_a:.3f}（顶背离）", marks
    return False, "价与 DIF 同步新高，无背离", marks


def detect_m_head(df, tolerance_pct, prominence_pct):
    """
    疑似双顶 / M 头（红线 A_R2 预警）：两高点差 < 容差 且 中间颈线被跌破
    返回 (疑似, 说明, marks)
    """
    sub = df.tail(int(pget('retrace_lookback', 60))).reset_index(drop=True)
    if len(sub) < 20:
        return False, "数据不足", []
    highs, lows = find_swings(sub, window=3)
    if len(highs) < 2:
        return False, "无两个有效高点", []
    h_vals = {i: float(sub.loc[i, 'high']) for i in highs}
    top2 = sorted(h_vals, key=lambda i: h_vals[i], reverse=True)[:2]
    top2.sort()
    a, b = top2
    if b - a < 3:
        return False, "两高点过近", []
    diff_pct = abs(h_vals[b] - h_vals[a]) / h_vals[a] * 100
    if diff_pct > float(tolerance_pct):
        return False, f"两高点差 {diff_pct:.1f}% > {tolerance_pct}%，非等高双顶", []
    valley = min((l for l in lows if a < l < b), key=lambda i: float(sub.loc[i, 'low']), default=None)
    if valley is None:
        return False, "两顶之间无有效低点", []
    neck = float(sub.loc[valley, 'low'])
    depth = (h_vals[a] - neck) / h_vals[a] * 100
    if depth < float(prominence_pct):
        return False, f"颈线过浅（{depth:.1f}%），不算有效双顶", []
    broken = float(sub['close'].iloc[-1]) < neck
    marks = [
        {"date": str(sub.loc[a, 'date']), "price": rnd(h_vals[a], 3), "kind": "m_head"},
        {"date": str(sub.loc[b, 'date']), "price": rnd(h_vals[b], 3), "kind": "m_head"},
        {"date": str(sub.loc[valley, 'date']), "price": rnd(neck, 3), "kind": "neckline"},
    ]
    if broken:
        return True, f"疑似 M 头：两顶 {h_vals[a]:.2f}/{h_vals[b]:.2f}（差 {diff_pct:.1f}%），颈线 {neck:.2f} 已跌破", marks
    return False, f"双顶雏形但颈线 {neck:.2f} 未破，暂不判反转", marks


# ============================================================ 招财进宝多模块原始判定（M3~M8）
# 约定：本区只输出「事实 + 命中与否 + 中文依据」，**不算分**。子项分值/模块权重/开关
#       全在后端 config/fortune_criteria.json（items.points / weight / enabled）里折算，
#       这样改分值不用动 Python。阈值（窗口、倍数、容差）全部走 fp_* 参数，不硬编码。

def _fp_num(v, nd=2):
    """详情文案用：None → '—'，否则固定小数位"""
    return '—' if v is None else f"{v:,.{nd}f}"


def _fp_int(v):
    return '—' if v is None else f"{v:,.0f}"


def fp_volume_series(df, ind):
    """量能序列：盘中末根换成按已交易时间折算的全天估算量（与追资金口径一致）"""
    v = df['volume'].astype(float).copy()
    if ind.get('is_live') and len(v):
        ev = num(ind.get('est_volume'))
        if ev is not None:
            v.iloc[-1] = ev
    return v


def fp_volume_price(df, ind):
    """M3 基础量价逻辑（累加型）：突破放量 / 回调缩量 / 新高无量 / 放量滞涨"""
    win = max(2, int(pget('fp_window_break', 20)))
    mav_win = max(2, int(pget('vol_ma_period', 20)))
    n = len(df)
    v = fp_volume_series(df, ind)
    # 均量不含当日（shift(1)），否则当日自身把基数拉高、放量倍数失真
    mav = v.shift(1).rolling(mav_win).mean()
    mav20 = num(mav.iloc[-1])
    price = num(df['close'].iloc[-1])
    high = num(df['high'].iloc[-1])
    today_v = num(v.iloc[-1])
    pct = num(ind.get('today_pct'))

    prior = df['high'].iloc[max(0, n - 1 - win):n - 1]
    prev_high = num(prior.max()) if len(prior) else None
    prev_high_idx = prior.idxmax() if len(prior) and prev_high is not None else None
    vol_at_prev_high = num(v.loc[prev_high_idx]) if prev_high_idx is not None else None

    break_thr = None if mav20 is None else mav20 * float(pget('fp_vol_break_ratio', 1.1))
    shrink_thr = None if mav20 is None else mav20 * float(pget('fp_vol_shrink_ratio', 0.7))
    stall_thr = None if mav20 is None else mav20 * float(pget('fp_stall_vol_ratio', 1.2))

    # vp1 突破放量：收盘上穿窗口前高 + 量达标
    vp1 = None not in (price, prev_high, break_thr, today_v) and price > prev_high and today_v > break_thr
    d1 = (f"收盘 {_fp_num(price)} vs 前 {win} 根高点 {_fp_num(prev_high, 3)}；"
          f"量 {_fp_int(today_v)} vs MAV{mav_win}×{pget('fp_vol_break_ratio', 1.1)}={_fp_int(break_thr)}")
    if prev_high is not None and price is not None and price <= prev_high:
        d1 += '（未突破前高，不给分）'

    # vp2 回调缩量：连续回落 + 缩量
    k = max(1, int(pget('fp_pullback_days', 2)))
    downs, closes = 0, df['close'].astype(float)
    for j in range(n - 1, max(0, n - 1 - k) - 1, -1):
        if j < 1:
            break
        if num(closes.iloc[j]) is None or num(closes.iloc[j - 1]) is None:
            break
        if closes.iloc[j] < closes.iloc[j - 1]:
            downs += 1
        else:
            break
    vp2 = downs >= k and None not in (shrink_thr, today_v) and today_v < shrink_thr
    d2 = (f"连续回落 {downs}/{k} 根；量 {_fp_int(today_v)} vs 缩量线 {_fp_int(shrink_thr)}"
          f"（MAV{mav_win}×{pget('fp_vol_shrink_ratio', 0.7)}）")

    # vp3 新高无量（量价背离，风险）
    new_high = None not in (high, prev_high) and high > prev_high
    vp3 = new_high and None not in (today_v, vol_at_prev_high) and today_v < vol_at_prev_high
    d3 = (f"盘中 {_fp_num(high, 3)} 创近 {win} 根新高，量 {_fp_int(today_v)} < 前高量 "
          f"{_fp_int(vol_at_prev_high)}（无量推进）" if new_high
          else f"未创窗口新高（盘中 {_fp_num(high, 3)} vs 前高 {_fp_num(prev_high, 3)}），无背离")

    # vp4 放量滞涨（风险）
    stall_max = float(pget('fp_stall_max_pct', 0.5))
    vp4 = None not in (stall_thr, today_v, pct) and today_v > stall_thr and abs(pct) < stall_max
    d4 = (f"量 {_fp_int(today_v)} > 放量线 {_fp_int(stall_thr)}，但涨跌幅 {pct:+.2f}% "
          f"不足 {stall_max}%（大量成交不推进）" if vp4 else
          f"量 {_fp_int(today_v)}（放量线 {_fp_int(stall_thr)}），涨跌幅 "
          f"{_fp_num(pct)}%（需 <{stall_max}% 才命中）")

    return {
        "model": "accumulate",
        "items": [
            {"id": "vp1", "met": bool(vp1), "detail": d1},
            {"id": "vp2", "met": bool(vp2), "detail": d2},
            {"id": "vp3", "met": bool(vp3), "type": "risk", "detail": d3},
            {"id": "vp4", "met": bool(vp4), "type": "risk", "detail": d4},
        ],
        "facts": {
            "window": win, "vol_ma_period": mav_win, "mav": rnd(mav20, 0),
            "prev_high": rnd(prev_high, 3), "vol_at_prev_high": rnd(vol_at_prev_high, 0),
            "volume": rnd(today_v, 0),
            "vol_ratio": rnd(today_v / mav20, 3) if (today_v is not None and mav20) else None,
        },
    }


def fp_slope_pos(series, bars):
    """最近 bars 根均线最小二乘斜率是否 > 0（样本不足返回 None）"""
    vals = [num(x) for x in list(series.iloc[-int(bars):])]
    vals = [x for x in vals if x is not None]
    if len(vals) < 2:
        return None
    k = len(vals)
    xm = (k - 1) / 2.0
    ym = sum(vals) / k
    den = sum((i - xm) ** 2 for i in range(k))
    if not den:
        return None
    return (sum((i - xm) * (y - ym) for i, y in enumerate(vals)) / den) > 0


def fp_ma(df, ind):
    """M4 均线体系（累加型）：MA20/MA30 方向、价格相对位置、多头排列；另给排列标签"""
    sp, lp = int(pget('fp_ma_short', 20)), int(pget('fp_ma_long', 30))
    s = df['close'].rolling(sp).mean()
    l = df['close'].rolling(lp).mean()
    ms, msp = num(s.iloc[-1]), num(s.iloc[-2]) if len(df) > 1 else None
    ml, mlp = num(l.iloc[-1]), num(l.iloc[-2]) if len(df) > 1 else None
    price = num(df['close'].iloc[-1])
    slope_bars = max(1, int(pget('fp_ma_slope_bars', 1)))

    def direction(series, cur, prev, label):
        """向上判定：默认对比前一根；fp_ma_slope_bars>1 改用拟合斜率"""
        if slope_bars > 1:
            pos = fp_slope_pos(series, slope_bars)
            return bool(pos) if pos is not None else False, f"{label} 近 {slope_bars} 根拟合斜率{'向上' if pos else '走平/向下'}"
        ok = None not in (cur, prev) and cur > prev
        return bool(ok), f"{label} {_fp_num(cur, 3)} vs 前值 {_fp_num(prev, 3)}（{'向上' if ok else '走平/向下'}）"

    up_s, ds = direction(s, ms, msp, f"MA{sp}")
    up_l, dl = direction(l, ml, mlp, f"MA{lp}")
    above_s = None not in (price, ms) and price > ms
    above_l = None not in (price, ml) and price > ml
    bull = None not in (ms, ml) and ms > ml

    # 排列标签（只作参考展示，不重复计分）
    gap_pct = (abs(ms - ml) / ml * 100) if (ms is not None and ml) else None
    tangle_lt = float(pget('fp_box_min_amp_pct', 4.0)) / 4.0
    if gap_pct is None:
        label = '数据不足'
    elif gap_pct < tangle_lt:
        label = '缠绕震荡'
    else:
        label = '多头排列' if bull else '空头排列'

    return {
        "model": "accumulate",
        "state_label": label,
        "items": [
            {"id": "ma20_up", "met": up_s, "detail": ds},
            {"id": "ma30_up", "met": up_l, "detail": dl},
            {"id": "above_ma20", "met": above_s, "detail": f"收盘 {_fp_num(price, 3)} vs MA{sp} {_fp_num(ms, 3)}"},
            {"id": "above_ma30", "met": above_l, "detail": f"收盘 {_fp_num(price, 3)} vs MA{lp} {_fp_num(ml, 3)}"},
            {"id": "ma_bull", "met": bull, "detail": f"MA{sp} {_fp_num(ms, 3)} vs MA{lp} {_fp_num(ml, 3)}（{label}，间距 {_fp_num(gap_pct, 2)}%）"},
        ],
        "facts": {
            "ma_short_period": sp, "ma_long_period": lp, "slope_bars": slope_bars,
            "ma_short": rnd(ms, 3), "ma_short_prev": rnd(msp, 3),
            "ma_long": rnd(ml, 3), "ma_long_prev": rnd(mlp, 3),
            "close": rnd(price, 3), "gap_pct": rnd(gap_pct, 2), "arrange": label,
        },
    }


def fp_dmi(df, ind):
    """M5 ADX/DMI 趋势强度（分档型，只命中一档）：从上到下优先级匹配、命中即停止（v4.1 定档：8% 权重计入 A 买入总分）
    顺序：①强多头 ②中多头 ③弱多头 ④震荡 ⑤空头兜底；只要 PDI>MDI 多头先落档（ADX<weak 也算弱多头），非多头侧才看震荡档"""
    period = int(pget('fp_dmi_period', 14))
    if 'adx' in df.columns and period == int(pget('n_adx', 14)):
        adx, pdi, mdi = num(df['adx'].iloc[-1]), num(df['pdi'].iloc[-1]), num(df['mdi'].iloc[-1])
    else:  # 周期被改过就本地重算一次（copy 不污染追资金在用的 df）
        tmp = calc_adx(df.copy(), period, int(pget('n_adx_smooth', 6)))
        adx, pdi, mdi = num(tmp['adx'].iloc[-1]), num(tmp['pdi'].iloc[-1]), num(tmp['mdi'].iloc[-1])
    strong, trend, weak = float(pget('fp_adx_strong', 40)), float(pget('fp_adx_trend', 25)), float(pget('fp_adx_weak', 20))
    facts = {"adx": rnd(adx, 2), "pdi": rnd(pdi, 2), "mdi": rnd(mdi, 2), "period": period,
             "ad_thresholds": {"strong": strong, "trend": trend, "weak": weak}}
    if None in (adx, pdi, mdi):
        return {"model": "tier", "state": None, "items": [], "facts": facts, "note": 'DMI 数据不足（预热 K 线不够）'}
    base = f"ADX {adx:.1f}（强/趋势/震荡线 {strong:g}/{trend:g}/{weak:g}），PDI {pdi:.1f} vs MDI {mdi:.1f}"
    if pdi > mdi:  # 优先级①②③：多头占优先按 ADX 强度落多头档（弱多头优先于震荡）
        if adx > strong:
            state, detail = 't_strong_bull', base + '；优先级① 强多头趋势'
        elif adx > trend:
            state, detail = 't_mid_bull', base + '；优先级② 多头趋势成型'
        else:
            state, detail = 't_weak_bull', base + '；优先级③ 多头占优但强度不足（ADX≤趋势线也先落弱多头，不落震荡）'
    elif adx < weak:  # 优先级④：非多头占优且 ADX 低于震荡线 → 震荡行情
        state, detail = 't_choppy', base + '；优先级④ 震荡行情，不适合趋势策略'
    else:  # 优先级⑤兜底：MDI≥PDI 且 ADX 不达震荡档 → 空头占优
        state, detail = 't_bear', base + '；优先级⑤ 空头占优 → 0 分（ADX 高只说明杀跌有强度）'
    return {"model": "tier", "state": state, "items": [{"id": state, "met": True, "detail": detail}], "facts": facts}


def fp_fib(df, ind):
    """M6 斐波那契回撤/反弹价位（分档型）：简易全局波段，后续可升级为 HH/HL 分段"""
    look = max(5, int(pget('fp_fib_lookback', 60)))
    tol = float(pget('fp_fib_tolerance', 2.0))
    sub = df.tail(look)
    price = num(df['close'].iloc[-1])
    hi_idx, lo_idx = sub['high'].idxmax(), sub['low'].idxmin()
    h, l = num(df.loc[hi_idx, 'high']) if hi_idx is not None else None, num(df.loc[lo_idx, 'low']) if lo_idx is not None else None
    rng = None if (h is None or l is None) else h - l
    ratios = pget('fp_fib_ratios', [0.236, 0.382, 0.5, 0.618]) or [0.236, 0.382, 0.5, 0.618]
    if not (price and rng and rng > 0):
        return {"model": "tier", "state": None, "items": [], "facts": {"close": rnd(price, 3)}, "note": '波段幅度为 0 或数据不足，无法算斐波那契位'}
    up_wave = hi_idx > lo_idx  # 低点在前、高点在后 → 上涨波段（看回踩支撑）；反之 → 下跌波段（看反弹压力）
    op = num(df['open'].iloc[-1])
    last_pct = num(df['pct'].iloc[-1]) if 'pct' in df.columns else None
    bullish = (price > op) if op is not None else bool((last_pct or 0) > 0)
    levels, nearest = {}, None
    for r in ratios:
        lv = (h - rng * float(r)) if up_wave else (l + rng * float(r))
        key = f"{float(r):g}"
        dev = abs(price - lv) / price * 100
        levels[key] = {"price": rnd(lv, 3), "deviation_pct": rnd(dev, 2)}
        if nearest is None or dev < nearest[1]:
            nearest = (key, dev)
    nk, nd = nearest
    key_ratios = {'0.5', '0.618', '.5', '.618'}
    wave_txt = '上涨波段回踩支撑' if up_wave else '下跌波段反弹压力'
    base = (f"{wave_txt}：波段高 {_fp_num(h, 3)} / 低 {_fp_num(l, 3)}（振幅 {rng / price * 100:.1f}%），"
            f"现价 {_fp_num(price, 3)} 距 {nk} 位 {_fp_num(nd, 2)}%（容差 {tol:g}%），"
            f"当日{'收阳' if bullish else '收阴'}")
    if nd > tol:
        state, detail = 'f_na', base + ' → 不在关键回撤区，中性参考'
    elif not up_wave and not bullish:
        state, detail = 'f_resist', base + ' → 反弹触及压力位承压回落'
    elif up_wave and nk in key_ratios and bullish:
        state, detail = 'f_key_hold', base + ' → 回踩关键支撑止跌收阳'
    elif up_wave and nk == '0.382':
        state, detail = 'f382_hold', base + ' → 浅回踩 0.382 企稳'
    else:
        state, detail = 'f_na', base + f' → 落在 {nk} 位（非关键档或方向不匹配），中性参考'
    facts = {"wave_high": rnd(h, 3), "wave_low": rnd(l, 3), "range": rnd(rng, 3),
             "direction": 'up_wave' if up_wave else 'down_wave', "lookback": look,
             "levels": levels, "nearest_level": nk, "nearest_deviation_pct": rnd(nd, 2)}
    return {"model": "tier", "state": state, "items": [{"id": state, "met": True, "detail": detail}], "facts": facts}


def fp_box(df, ind):
    """M7 箱体区间（分档型）：上沿/下沿取前 N 根极值（不含当日），突破一律看收盘价"""
    win = max(2, int(pget('fp_box_window', 20)))
    tol = float(pget('fp_box_retest_tolerance_pct', 1.0))
    min_amp = float(pget('fp_box_min_amp_pct', 4.0))
    n = len(df)
    prior = df.iloc[max(0, n - 1 - win):n - 1]
    box_top, box_bottom = num(prior['high'].max()), num(prior['low'].min())
    price = num(df['close'].iloc[-1])
    if None in (box_top, box_bottom, price) or box_bottom <= 0:
        return {"model": "tier", "state": None, "items": [], "facts": {"close": rnd(price, 3)}, "note": '箱体数据不足'}
    amp_pct = (box_top - box_bottom) / box_bottom * 100
    mid = (box_top + box_bottom) / 2
    base = (f"箱体（前 {win} 根，不含当日）上沿 {_fp_num(box_top, 3)} / 中轨 {_fp_num(mid, 3)} / "
            f"下沿 {_fp_num(box_bottom, 3)}，振幅 {amp_pct:.1f}%（最小 {min_amp:g}%），收盘 {_fp_num(price, 3)}")
    if amp_pct < min_amp:
        state, detail = 'b_narrow', base + ' → 振幅不足，不构成有效箱体，按震荡中性处理'
    elif price > box_top:
        state, detail = 'b_break', base + ' → 收盘站上上沿（突破确认，非盘中刺破）'
    elif abs(price - box_top) / box_top * 100 <= tol:
        state, detail = 'b_retest', base + f' → 贴在上沿 ±{tol:g}% 内且未收在下方（回踩支撑）'
    elif price < box_bottom:
        state, detail = 'b_break_down', base + ' → 收盘跌破下沿（破位）'
    else:
        state, detail = 'b_inside', base + ' → 箱体内部震荡'
    return {"model": "tier", "state": state,
            "items": [{"id": state, "met": True, "detail": detail}],
            "facts": {"box_top": rnd(box_top, 3), "box_bottom": rnd(box_bottom, 3), "mid": rnd(mid, 3),
                      "amp_pct": rnd(amp_pct, 2), "window": win, "min_amp_pct": min_amp}}


def fp_candle(df, ind):
    """M8 基础蜡烛线（分档型，默认不计分、只提示）：锤子线 / 看涨吞没 / 看跌吞没"""
    o, h, l, c = num(df['open'].iloc[-1]), num(df['high'].iloc[-1]), num(df['low'].iloc[-1]), num(df['close'].iloc[-1])
    po, pc = num(df['open'].iloc[-2]) if len(df) > 1 else None, num(df['close'].iloc[-2]) if len(df) > 1 else None
    if None in (o, h, l, c) or h <= l:
        return {"model": "tier", "state": 'c_none', "items": [{"id": "c_none", "met": True, "detail": 'K 线数据不足，未做形态判定'}],
                "facts": {}}
    rng_ratio = float(pget('fp_candle_shadow_body_ratio', 2))
    up_ratio = float(pget('fp_candle_upper_body_ratio', 0.3))
    pos_min = float(pget('fp_candle_body_pos_min', 0.6))
    look = max(1, int(pget('fp_candle_trend_lookback', 5)))
    body = abs(c - o)
    body_eff = max(body, c * 0.001)  # 十宁/一字护体：避免实体为 0 时比例无意义
    upper = h - max(o, c)
    lower = min(o, c) - l
    body_pos = (max(o, c) - l) / (h - l)
    ref = num(df['close'].iloc[-1 - look])
    trend_pct = (c / ref - 1) * 100 if ref else None
    geom = (f"实体 {body_eff:.3f}，上影 {upper:.3f}，下影 {lower:.3f}，实体位置 {body_pos * 100:.0f}%"
            f"（需 ≥{pos_min * 100:g}%），近 {look} 根累计 {_fp_num(trend_pct, 2)}%")
    hammer = (lower >= body_eff * rng_ratio and upper <= body_eff * up_ratio
              and body_pos >= pos_min and (trend_pct is not None and trend_pct < 0))
    prev_bear = None not in (po, pc) and pc < po
    prev_bull = None not in (po, pc) and pc > po
    bullish, bearish = c > o, c < o
    bull_engulf = prev_bear and bullish and c > po and o < pc
    bear_engulf = prev_bull and bearish and c < po and o > pc
    if hammer:
        state, detail = 'c_hammer', geom + ' → 下影够长、上影短、实体在上端且前置下跌，标准锤子线（底部看涨）'
    elif bull_engulf:
        state, detail = 'c_bull_engulf', geom + f'→ 昨阴（{_fp_num(pc, 3)}/{_fp_num(po, 3)}）今阳实体完全包住，看涨吞没'
    elif bear_engulf:
        state, detail = 'c_bear_engulf', geom + f'→ 昨阳（{_fp_num(pc, 3)}/{_fp_num(po, 3)}）今阴实体完全包住，看跌吞没（顶部预警，仅提示不扣分）'
    else:
        state, detail = 'c_none', geom + ' → 未命中标准形态（数学近似不等于看图标准形态，人工复核优先）'
    return {"model": "tier", "state": state, "items": [{"id": state, "met": True, "detail": detail}],
            "facts": {"open": rnd(o, 3), "high": rnd(h, 3), "low": rnd(l, 3), "close": rnd(c, 3),
                      "prev_open": rnd(po, 3), "prev_close": rnd(pc, 3),
                      "body": rnd(body, 3), "upper_shadow": rnd(upper, 3), "lower_shadow": rnd(lower, 3),
                      "body_pos": rnd(body_pos, 3), "trend_pct": rnd(trend_pct, 2)}}


def fortune_modules(df, ind):
    """
    招财进宝 M3~M8 模块原始判定（只给后端下发 fp_compute=true 时跑，追资金不受影响）
    返回 {module_code: {model, items|state, facts}}；日线不足 30 根返回 None（后端按「无法判定」剔除该模块权重）
    """
    if df is None or len(df) < 30:
        return None
    return clean({
        "volume_price": fp_volume_price(df, ind),
        "ma": fp_ma(df, ind),
        "dmi": fp_dmi(df, ind),
        "fib": fp_fib(df, ind),
        "box": fp_box(df, ind),
        "candle": fp_candle(df, ind),
    })


# ============================================================ 衰竭止盈 W1～W8（sell_modules）

def _wp_item(iid, met, detail):
    return {"id": iid, "met": bool(met), "detail": detail}


def _wp_group(items, facts, applicable=True, note=None):
    out = {"model": "accumulate", "applicable": bool(applicable), "items": items, "facts": facts}
    if note:
        out["note"] = note
    return out


def wp_granville_sell(df, ind):
    """W1 葛兰碧卖出信号组：乖离超买（w1_1 分档 level）/回踩不上/跌破均线+拐头/反弹承压"""
    p = max(5, int(pget('wp_ma_ref', 20)))
    s = df['close'].rolling(p).mean()
    price = num(df['close'].iloc[-1])
    m, mp, mp2 = num(s.iloc[-1]), num(s.iloc[-2]), num(s.iloc[-3]) if len(df) > 2 else None
    light, midv, severe = float(pget('wp_dev_light', 5)), float(pget('wp_dev_mid', 8)), float(pget('wp_dev_severe', 12))
    brk = float(pget('wp_valid_break_pct', 2)) / 100
    dev = (price / m - 1) * 100 if (m and price is not None) else None
    level = 0
    if dev is not None:
        if dev >= severe: level = 3
        elif dev >= midv: level = 2
        elif dev >= light: level = 1
    tier_txt = {0: '未触发', 1: '轻度', 2: '明显', 3: '严重'}[level]
    i1 = _wp_item('w1_1', level > 0,
                  f"收盘 {_fp_num(price, 3)} vs MA{p} {_fp_num(m, 3)}，乖离 {_fp_num(dev, 2)}%（轻/显/严 {light:g}/{midv:g}/{severe:g}%）→ {tier_txt}")
    # w1_2 回踩均线无法重新站上：MA 仍上行，近 5 根曾触及均线，但近 3 根收盘连续未重新站上且现价已在线下
    lows5 = [num(df['low'].iloc[-k]) for k in range(5, 0, -1)]
    mas5 = [num(s.iloc[-k]) for k in range(5, 0, -1)]
    touch = any(l is not None and mm is not None and l <= mm * 1.01 for l, mm in zip(lows5, mas5))
    below3 = all(num(df['close'].iloc[-k]) is not None and num(s.iloc[-k]) is not None
                 and num(df['close'].iloc[-k]) < num(s.iloc[-k]) * (1 - brk) for k in range(1, 4)) if len(df) >= 3 else False
    rising = None not in (m, mp2) and m > mp2
    ok2 = bool(touch and below3 and rising and m and price is not None and price < m * (1 - brk))
    i2 = _wp_item('w1_2', ok2, f"回踩触线={'是' if touch else '否'}，近3根收盘均未重新站上 MA{p}×(1−{brk*100:g}%)={'是' if below3 else '否'}，均线{'上行' if rising else '未上行'}")
    # w1_3 跌破均线 + 均线拐头走平向下：有效跌破且均线由升转平/拐头（前一根还在升，本根不再升）
    turn = None not in (m, mp, mp2) and mp > mp2 and m <= mp
    ok3 = bool(m and price is not None and price < m * (1 - brk) and turn)
    i3 = _wp_item('w1_3', ok3, f"收盘 {_fp_num(price, 3)} 有效跌破 MA{p} {_fp_num(m, 3)}（>{brk*100:g}%）={'是' if (m and price is not None and price < m * (1 - brk)) else '否'}；均线 {_fp_num(mp, 3)}→{_fp_num(m, 3)} {'由升转平/拐头向下' if turn else '仍在上行'}")
    # w1_4 反弹碰均线承压回落：均线向下，价在线下反弹触及均线后当日收阴
    fall = None not in (m, mp) and m < mp
    below = m and price is not None and price < m
    maxh5 = num(df['high'].tail(5).max())
    touched = maxh5 is not None and m is not None and maxh5 >= m * 0.99
    o = num(df['open'].iloc[-1])
    bearish = None not in (o, price) and price < o
    ok4 = bool(fall and below and touched and bearish)
    i4 = _wp_item('w1_4', ok4, f"MA{p} {'向下' if fall else '不向下'}；近5高 {_fp_num(maxh5, 3)} 触及均线={'是' if touched else '否'}；当日{'收阴' if bearish else '未收阴'}")
    facts = {"ma_period": p, "ma": rnd(m, 3), "ma_prev": rnd(mp, 3), "close": rnd(price, 3),
             "deviation_pct": rnd(dev, 2), "dev_level": level,
             "dev_thresholds": {"light": light, "mid": midv, "severe": severe}}
    return _wp_group([i1, i2, i3, i4], facts)


def wp_dow_fail(df, ind):
    """W2 道氏结构衰竭：新高抬升幅度收窄 / 有效回调低点被跌破。无清晰波段结构整组不生效"""
    look, win = int(pget('wp_struct_lookback', 60)), max(1, int(pget('wp_swing_window', 3)))
    price = num(df['close'].iloc[-1])
    sub = df.tail(look).reset_index(drop=True)
    highs, lows = find_swings(sub, window=win)
    facts = {"lookback": look, "swing_window": win, "swing_highs": len(highs), "swing_lows": len(lows),
             "close": rnd(price, 3)}
    if len(highs) < 2 or len(lows) < 2:
        facts["h_vals"] = [rnd(num(sub.loc[i, 'high']), 3) for i in highs]
        facts["l_vals"] = [rnd(num(sub.loc[i, 'low']), 3) for i in lows]
        return _wp_group([_wp_item('w2_0', False, '无清晰波段结构，本组不生效'),
                          _wp_item('w2_1', False, '无清晰波段结构，本组不生效')],
                         facts, applicable=False, note='无清晰波段结构（高低点不足两段），本组不生效不计分')
    h_vals = [num(sub.loc[i, 'high']) for i in highs]
    l_vals = [num(sub.loc[i, 'low']) for i in lows]
    facts["h_vals"] = [rnd(x, 3) for x in h_vals]
    facts["l_vals"] = [rnd(x, 3) for x in l_vals]
    # w2_0 新高抬升幅度持续收窄：需至少 3 个波段高点，末段抬升 < 前段抬升×比例（或绝对幅度<下限）
    ratio, min_pct = float(pget('wp_hh_shrink_ratio', 0.5)), float(pget('wp_hh_shrink_min_pct', 2))
    if len(h_vals) >= 3 and None not in (h_vals[-1], h_vals[-2], h_vals[-3]):
        up_last, up_prev = h_vals[-1] - h_vals[-2], h_vals[-2] - h_vals[-3]
        pct_last = up_last / h_vals[-2] * 100 if h_vals[-2] else None
        ok20 = (up_last > 0 and up_prev > 0 and up_last < up_prev * ratio) or (up_last > 0 and pct_last is not None and pct_last < min_pct)
        d20 = (f"两段新高抬升 {rnd(up_prev, 3)}→{rnd(up_last, 3)}（末段幅度 {_fp_num(pct_last, 2)}%，"
               f"门槛：前段×{ratio:g} 或幅度<{min_pct:g}%）")
    else:
        ok20, d20 = False, '波段高点不足 3 个，无法比较抬升幅度'
    # w2_1 有效回调低点被跌破：收盘跌破最近一个波段回调低点 = 趋势反转确认
    last_l = l_vals[-1]
    ok21 = None not in (price, last_l) and price < last_l
    i21 = _wp_item('w2_1', ok21, f"收盘 {_fp_num(price, 3)} vs 最近有效回调低 {_fp_num(last_l, 3)}（{'已跌破，趋势反转确认' if ok21 else '未跌破'}）")
    return _wp_group([_wp_item('w2_0', ok20, d20), i21], facts)


def wp_volume_fail(df, ind):
    """W3 量价衰竭：新高量不及前高 / 高位放量滞涨 / 高位放量长上影。高位=现价距 60 日高 ≤ wp_high_zone_pct%"""
    price = num(df['close'].iloc[-1])
    today_high = num(df['high'].iloc[-1])
    today_vol = num(df['volume'].iloc[-1])
    vma = ind.get('vol_ma')
    high60 = ind.get('high60')
    hv_zone = float(pget('wp_high_zone_pct', 3)) / 100
    at_high = None not in (price, high60) and high60 > 0 and price >= high60 * (1 - hv_zone)
    o = num(df['open'].iloc[-1])
    body = abs((price or 0) - (o or 0))
    body_eff = max(body, (price or 0) * 0.001)
    upper = (today_high - max(o or 0, price or 0)) if today_high is not None else None
    facts = {"close": rnd(price, 3), "high60": rnd(high60, 3), "at_high": at_high,
             "today_vol": rnd(today_vol, 0), "vma20": rnd(vma, 0), "vol_ratio": rnd((today_vol / vma) if (today_vol and vma) else None, 2)}
    # w3_1 新高但量能低于前高（量价顶背离）：今日盘中创 60 日新高，量 < 前高当日量×比例
    div_ratio = float(pget('wp_vol_div_ratio', 0.8))
    prior = df['high'].iloc[-60:-1]
    ok31, d31 = False, '今日未创 60 日新高，无顶背离'
    if today_high is not None and high60 is not None and today_high >= high60 * 0.999 and len(prior.dropna()):
        pi = prior.idxmax()
        prev_hi, prev_vol = num(prior.loc[pi]), num(df['volume'].loc[pi])
        facts["prev_high"], facts["prev_high_vol"] = rnd(prev_hi, 3), rnd(prev_vol, 0)
        ok31 = None not in (today_vol, prev_vol) and prev_vol > 0 and today_vol < prev_vol * div_ratio
        d31 = (f"新高 {rnd(today_high, 3)}≥前高 {rnd(prev_hi, 3)}，当日量 {rnd(today_vol, 0)} vs 前高日量 {rnd(prev_vol, 0)}"
               f"（需<{div_ratio:g}×，实际 {rnd(today_vol / prev_vol, 2) if (today_vol and prev_vol) else '—'}×）")
    # w3_2 高位放量滞涨、高换手不创新高：高位区 + 量≥倍数×MAV20 + 涨幅≤上限 + 收盘未创 60 日收盘新高
    stall_mult, stall_pct = float(pget('wp_stall_vol_mult', 1.5)), float(pget('wp_stall_pct_max', 0.5))
    turnover = num(df['turnover'].iloc[-1]) if 'turnover' in df.columns else None
    c_max60 = num(df['close'].iloc[-60:-1].max())
    no_new_close = None not in (price, c_max60) and price < c_max60
    vol_ok = None not in (today_vol, vma) and vma > 0 and today_vol >= vma * stall_mult
    pct_now = num(df['pct'].iloc[-1])
    flat = pct_now is not None and abs(pct_now) <= stall_pct
    ok32 = bool(at_high and vol_ok and flat and no_new_close)
    to_txt = f"，换手 {_fp_num(turnover, 2)}%（门槛 {pget('wp_turnover_min', 8)}%）" if turnover is not None else '，换手数据缺失不卡'
    d32 = (f"高位区={'是' if at_high else '否'}，量 {rnd((today_vol / vma) if (today_vol and vma) else None, 2)}×MAV20"
           f"（需≥{stall_mult:g}×），涨幅 {_fp_num(pct_now, 2)}%（需≤{stall_pct:g}%），收盘未创新低位新高={no_new_close}{to_txt}")
    # w3_3 高位放量长上影冲高回落：盘中创阶段新高后回落，上影≥实体×倍数、距高点回落≥百分比、量够
    sh_mult, sh_drop, sh_vol = float(pget('wp_shadow_body_mult', 2)), float(pget('wp_shadow_drop_pct', 3)), float(pget('wp_shadow_vol_mult', 1.5))
    new_high_today = None not in (today_high, high60) and today_high >= high60 * 0.999
    pullback = None not in (today_high, price) and today_high > 0 and (today_high - price) / today_high * 100 >= sh_drop
    long_shadow = None not in (upper,) and upper >= body_eff * sh_mult
    vol_ok3 = None not in (today_vol, vma) and vma > 0 and today_vol >= vma * sh_vol
    ok33 = bool(new_high_today and pullback and long_shadow and vol_ok3)
    drop_pct = (today_high - price) / today_high * 100 if (today_high and price is not None and today_high > 0) else None
    d33 = (f"盘中创新高={new_high_today}，上影 {_fp_num(upper, 3)} vs 实体 {_fp_num(body_eff, 3)}（需≥{sh_mult:g}×），"
           f"距高回落 {_fp_num(drop_pct, 2)}%（需≥{sh_drop:g}%），量 {rnd((today_vol / vma) if (today_vol and vma) else None, 2)}×（需≥{sh_vol:g}×）")
    facts["upper_shadow"], facts["pullback_pct"] = rnd(upper, 3), rnd(drop_pct, 2)
    return _wp_group([_wp_item('w3_1', ok31, d31), _wp_item('w3_2', ok32, d32), _wp_item('w3_3', ok33, d33)], facts)


def wp_fib_ext(df, ind):
    """W4 斐波那契扩展压力位：波段低→高外推 1.618/2.618；波段幅不足整组不生效"""
    look = max(10, int(pget('wp_fib_lookback', 60)))
    tol = float(pget('wp_fib_ext_tolerance', 2)) / 100
    min_amp = float(pget('wp_fib_min_amp_pct', 20))
    ratios = pget('wp_fib_ext_ratios', [1.618, 2.618]) or [1.618, 2.618]
    price = num(df['close'].iloc[-1])
    sub = df.tail(look)
    h, l = num(sub['high'].max()), num(sub['low'].min())
    rng = None if (h is None or l is None) else h - l
    amp_pct = (rng / l * 100) if (rng is not None and l) else None
    facts = {"lookback": look, "wave_high": rnd(h, 3), "wave_low": rnd(l, 3), "amp_pct": rnd(amp_pct, 2),
             "close": rnd(price, 3), "min_amp_pct": min_amp}
    if amp_pct is None or amp_pct < min_amp or rng is None or not price:
        return _wp_group([_wp_item('w4_1', False, '波段幅度不足或数据缺失，本组不生效'),
                          _wp_item('w4_2', False, '波段幅度不足或数据缺失，本组不生效')],
                         facts, applicable=False, note='无清晰波段结构（幅度 < 门槛），本组不生效不计分')
    exts = {float(r): l + rng * float(r) for r in ratios}
    facts["extensions"] = {f"{r:g}": rnd(v, 3) for r, v in exts.items()}
    e1618 = exts.get(1.618, exts[min(exts)])
    e2618 = exts.get(2.618)
    stall_bars = max(2, int(pget('wp_fib_stall_bars', 3)))
    near1 = abs(price - e1618) / price <= tol if e1618 else False
    seg = df.tail(stall_bars)
    seg_span = (num(seg['high'].max()) - num(seg['low'].min())) / price * 100 if len(seg) >= 2 and price else None
    stall = seg_span is not None and seg_span <= tol * 100 * 1.5  # 近 N 根窄幅震荡（振幅≤容差×1.5）
    ok41 = bool(near1 and stall)
    dev1 = abs((price - e1618) / price * 100) if (e1618 and price) else None
    d41 = (f"现价 {rnd(price, 3)} 距 1.618 扩展位 {rnd(e1618, 3)} {_fp_num(dev1, 2)}%（容差 {tol * 100:g}%），"
           f"近 {stall_bars} 根振幅 {_fp_num(seg_span, 2)}% → {'遇阻震荡' if ok41 else '未构成遇阻'}")
    fails = 0
    if e2618:
        for i in range(max(0, len(df) - look), len(df)):
            hi, cl = num(df['high'].iloc[i]), num(df['close'].iloc[i])
            if hi is not None and hi >= e2618 * (1 - tol) and (cl is None or cl < e2618):
                fails += 1
    need2 = int(pget('wp_ext2_fail_min', 2))
    ok42 = bool(e2618 and fails >= need2)
    d42 = (f"2.618 扩展位 {rnd(e2618, 3)}，窗口内盘中触及±{tol * 100:g}%内 {fails} 次且收盘未站上（需≥{need2}次）"
           if e2618 else '未配置 2.618 比例')
    return _wp_group([_wp_item('w4_1', ok41, d41), _wp_item('w4_2', ok42, d42)], facts)


def wp_candle_top(df, ind):
    """W5 高位看跌 K 线形态：黄昏星/看跌吞没/乌云盖顶/射击之星；非阶段高位一律不计分"""
    price = num(df['close'].iloc[-1])
    high60 = ind.get('high60')
    hv_zone = float(pget('wp_high_zone_pct', 3)) / 100
    at_high = None not in (price, high60) and high60 > 0 and price >= high60 * (1 - hv_zone)
    o, h, l, c = num(df['open'].iloc[-1]), num(df['high'].iloc[-1]), num(df['low'].iloc[-1]), price
    po, pc = num(df['open'].iloc[-2]), num(df['close'].iloc[-2])
    p2o, p2c = num(df['open'].iloc[-3]), num(df['close'].iloc[-3])
    body_mult = float(pget('wp_shadow_body_mult', 2))
    hits, geom_note = [], ''
    if None not in (o, h, l, c) and h > l:
        body = abs(c - o)
        body_eff = max(body, c * 0.001)
        upper = h - max(o, c)
        geom_note = f"实体 {_fp_num(body_eff, 3)}，上影 {_fp_num(upper, 3)}"
        if c < o and upper >= body_eff * body_mult:
            hits.append('射击之星')
        if None not in (po, pc) and pc > po and c < o and c < (po + pc) / 2 and o > pc:
            hits.append('乌云盖顶')
        if None not in (po, pc) and pc > po and c < o and o >= pc and c < po:
            hits.append('看跌吞没')
        if None not in (p2o, p2c) and p2c > p2o and abs(pc - po) <= (p2c - p2o) * 0.4 and c < o and c < (p2o + p2c) / 2:
            hits.append('黄昏星')
    ok5 = bool(at_high and hits)
    if not at_high:
        gap = (1 - price / high60) * 100 if (price and high60) else None
        detail = f"现价距 60 日高 {_fp_num(gap, 1)}%，超出高位区 {hv_zone * 100:g}%，非阶段高位不计分"
    else:
        detail = (f"处于阶段高位（距 60 日高≤{hv_zone * 100:g}%），命中形态：{'/'.join(hits) if hits else '无'}；{geom_note or 'K 线数据不足'}")
    facts = {"at_high": at_high, "patterns": hits, "close": rnd(price, 3), "high60": rnd(high60, 3)}
    return _wp_group([_wp_item('w5_1', ok5, detail)], facts)


def wp_box_fail(df, ind):
    """W6 箱体突破失败/上沿反复承压：振幅不足有效箱体整组不生效"""
    win = max(3, int(pget('wp_box_window', 20)))
    min_amp = float(pget('wp_box_min_amp_pct', 4))
    touch_min = int(pget('wp_box_touch_min', 3))
    fake_days = max(1, int(pget('wp_fake_break_days', 5)))
    fake_back = float(pget('wp_fake_back_pct', 1)) / 100
    seg = df.tail(win + 1).reset_index(drop=True)
    top, bottom = num(seg['high'].iloc[:-1].max()), num(seg['low'].iloc[:-1].min())
    price = num(df['close'].iloc[-1])
    amp_pct = (top - bottom) / bottom * 100 if (top is not None and bottom and bottom > 0) else None
    facts = {"window": win, "box_top": rnd(top, 3), "box_bottom": rnd(bottom, 3), "amp_pct": rnd(amp_pct, 2)}
    if amp_pct is None or amp_pct < min_amp:
        return _wp_group([_wp_item('w6_1', False, '不构成有效箱体，本组不生效'),
                          _wp_item('w6_2', False, '不构成有效箱体，本组不生效')],
                         facts, applicable=False, note='箱体振幅不足（<' + f'{min_amp:g}%' + '），本组不生效不计分')
    touches = closes_above = 0
    for i in range(len(seg)):
        hi, cl = num(seg['high'].iloc[i]), num(seg['close'].iloc[i])
        if hi is not None and hi >= top * 0.99:
            touches += 1
        if cl is not None and cl > top:
            closes_above += 1
    ok61 = touches >= touch_min and closes_above == 0
    d61 = f"近 {win + 1} 根盘中触及上沿 {top:.3}×0.99 共 {touches} 次（需≥{touch_min}），收盘站上 {closes_above} 次（需 0）"
    ok62, d62 = False, f'近 {fake_days} 根内无“收盘破上沿后又跌回”'
    tail = df.tail(fake_days + 2).reset_index(drop=True)
    broke_idx = [i for i in range(len(tail)) if num(tail['close'].iloc[i]) is not None and num(tail['close'].iloc[i]) > top]
    if broke_idx:
        after = [num(tail['close'].iloc[i]) for i in range(broke_idx[0] + 1, len(tail))]
        ok62 = any(x is not None and x < top * (1 - fake_back) for x in after)
        if ok62:
            d62 = f"曾收盘突破上沿 {rnd(top, 3)}，随后收盘跌回超 {fake_back * 100:g}%（假突破）"
    return _wp_group([_wp_item('w6_1', ok61, d61), _wp_item('w6_2', ok62, d62)], facts)


def wp_macd_div(df, ind):
    """W7 MACD 顶背离：复用追资金 detect_top_divergence，价创新高 DIF 未创新高"""
    look = int(pget('wp_div_lookback', 60))
    div, text, marks = detect_top_divergence(df, look)
    facts = {"lookback": look, "divergence": div, "marks": marks}
    return _wp_group([_wp_item('w7_1', div, text)], facts)


def wp_gain_risk(df, ind):
    """W8 阶段累计涨幅高位风险：wp_gain_period 日涨幅分两档（互斥）"""
    period = max(5, int(pget('wp_gain_period', 60)))
    r1 = pget('wp_gain_range1', [80, 150]) or [80, 150]
    r2 = float(pget('wp_gain_range2', 150))
    price = num(df['close'].iloc[-1])
    ref = num(df['close'].iloc[-(period + 1)]) if len(df) > period else None
    gain = (price / ref - 1) * 100 if (price and ref) else None
    facts = {"period": period, "ref_close": rnd(ref, 3), "close": rnd(price, 3), "gain_pct": rnd(gain, 2)}
    if gain is None:
        return _wp_group([_wp_item('w8_1', False, f'日线不足 {period} 根，无法算区间涨幅'),
                          _wp_item('w8_2', False, f'日线不足 {period} 根，无法算区间涨幅')], facts)
    lo, hi = float(r1[0]), float(r1[1])
    ok81 = lo <= gain <= hi
    ok82 = gain > max(hi, r2)
    base = f"近 {period} 日累计涨幅 {gain:.1f}%（档一 {lo:g}～{hi:g}%，档二 >{r2:g}%）"
    return _wp_group([_wp_item('w8_1', ok81, base), _wp_item('w8_2', ok82, base)], facts)


def sell_modules(df, ind):
    """
    招财进宝衰竭止盈 W1～W8 原始判定（只给后端下发 fp_sell_compute=true 时跑，追资金不受影响）
    返回 {w1..w8: {model:'accumulate', applicable, items, facts, note?}}；日线不足 30 根返回 None（后端按无法判定处理）
    """
    if df is None or len(df) < 30:
        return None
    return clean({
        "w1": wp_granville_sell(df, ind),
        "w2": wp_dow_fail(df, ind),
        "w3": wp_volume_fail(df, ind),
        "w4": wp_fib_ext(df, ind),
        "w5": wp_candle_top(df, ind),
        "w6": wp_box_fail(df, ind),
        "w7": wp_macd_div(df, ind),
        "w8": wp_gain_risk(df, ind),
    })

# ============================================================ 当日实时合成

def merge_live_bar(df, spot, today_str, elapsed_min):
    """
    把实时快照合成成「当日未收盘 K 线」接到日线尾部。
    返回 (df, is_live)  —— 收盘后或盘前不合成
    """
    if not spot or spot.get('price') is None:
        return df, False
    intraday = 0 < elapsed_min < TOTAL_TRADING_MIN
    last_date = str(df['date'].iloc[-1])
    row = {
        'date': today_str,
        'open': spot.get('open') or spot['price'],
        'high': spot.get('high') or spot['price'],
        'low': spot.get('low') or spot['price'],
        'close': spot['price'],
        'volume': spot.get('volume') or 0,
        'amount': spot.get('amount') or 0,
        'turnover': spot.get('turnover') or np.nan,
        'pct': spot.get('pct') or np.nan,
    }
    if last_date == today_str:
        # 接口已含当日（收盘后）→ 用实时值覆盖，避免两套数据
        df = df.drop(df.index[-1]).reset_index(drop=True)
    elif last_date > today_str:
        return df, False
    new_row = pd.DataFrame([row])
    df = pd.concat([df, new_row], ignore_index=True)
    return df, intraday


# ============================================================ 红线与打分

def hit(code, label, mode, detail):
    return {"code": code, "label": label, "mode": mode, "detail": detail}


def check_redlines(df, ctx, pool, ind):
    """按规则表逐条判定红线，返回 (触发的红线列表, 图上标记)"""
    out, marks = [], []
    last = df.iloc[-1]
    price = ind['price']

    if pool == 'A':
        # A_R1 顶背离 + 高位放量滞涨
        if ctx['enabled'].get('A_R1', True):
            div, div_text, div_marks = detect_top_divergence(df, pget('divergence_lookback', 60))
            stale = (ind['vol_ratio_est'] >= float(pget('stale_high_vol_ratio', 2.0))
                     and (ind['today_pct'] is None or ind['today_pct'] <= float(pget('stale_high_max_pct', 1.0))))
            at_high = price >= ind['high20'] * 0.995
            ctx['divergence'] = {"hit": div, "text": div_text}
            marks += div_marks
            if div and stale and at_high:
                out.append(hit("A_R1", "日线出现明确顶背离，高位放量滞涨", "auto",
                               f"{div_text}；折算量={ind['vol_ratio_est']:.2f}×均量，涨幅={ind['today_pct']:.2f}%"))
        # A_R2 疑似 M 头（semi：预警 + 需人工确认）
        if ctx['enabled'].get('A_R2', True):
            mh, mh_text, mh_marks = detect_m_head(df, pget('m_head_tolerance_pct', 3.0), pget('swing_prominence_pct', 5.0))
            marks += mh_marks
            if mh:
                out.append(hit("A_R2", "已经走出头肩顶、M 头等成熟反转形态", "semi", f"{mh_text}（需人工确认形态）"))
        # A_R3 关键均线有效跌破
        if ctx['enabled'].get('A_R3', True):
            tol = float(pget('valid_break_ma20_pct', 2.0))
            if ind['ma_mid_v'] and price < ind['ma_mid_v'] and (ind['ma_mid_v'] - price) / ind['ma_mid_v'] * 100 > tol:
                out.append(hit("A_R3", "关键均线被有效跌破，结构破坏", "auto",
                               f"现价 {price:.2f} 低于 MA{pget('ma_mid',20)} {ind['ma_mid_v']:.2f}，偏离 {(ind['ma_mid_v']-price)/ind['ma_mid_v']*100:.1f}%（门槛 {tol}%）"))
            elif ind['ma_long_v'] and price < ind['ma_long_v']:
                out.append(hit("A_R3", "关键均线被有效跌破，结构破坏", "auto",
                               f"现价 {price:.2f} 已跌破 MA{pget('ma_long',30)} {ind['ma_long_v']:.2f}"))
            elif ind['ma_mid_v'] and ind['ma_mid_prev'] and ind['ma_mid_v'] < ind['ma_mid_prev']:
                out.append(hit("A_R3", "关键均线被有效跌破，结构破坏", "auto",
                               f"MA{pget('ma_mid',20)} 由升转降（{ind['ma_mid_prev']:.2f} → {ind['ma_mid_v']:.2f}）"))
        # A_R4 今日涨幅超限（半自动）
        if ctx['enabled'].get('A_R4', True) and ind['today_pct'] is not None:
            lim = float(pget('a_max_today_pct', 7.0))
            if ind['today_pct'] > lim:
                out.append(hit("A_R4", "盘中不满足你的分时、涨幅规则", "semi",
                               f"今日涨幅 {ind['today_pct']:.2f}% > 上限 {lim}%，已拉高不追（分时形态仍需人工复核）"))
    else:
        # B_R1 破位杀跌初期（方案 B）：只过滤还在持续杀跌的票，三个条件同时成立才淘汰
        # 已止跌、不再创新低的票即使距低点偏高也不淘汰（距低点百分比降级为普通预警）
        if ctx['enabled'].get('B_R1', True):
            win = max(1, int(pget('b_r1_new_low_window', 10)))
            min_cnt = int(pget('b_r1_new_low_min_count', 2))
            vol_thr = float(pget('b_r1_down_vol_ratio', 1.2))
            low_thr = float(pget('b_dist_to_low_max', 15.0))
            fresh_days_max = int(pget('b_fresh_break_days', 3))
            dvr = ind.get('down_vol_ratio')
            fresh = ind['fresh_break_days_ago']
            nl60 = ind.get('new_low60_count') or 0
            c1 = nl60 >= min_cnt                                                    # 窗口内持续创新低
            c2a = dvr is not None and dvr >= vol_thr                                # 阴线均量高于均量（杀跌有量）
            c2b = fresh is not None and fresh <= fresh_days_max                      # 或窗口内刚发生放量破位
            c3 = ind['dist_to_low_pct'] is not None and ind['dist_to_low_pct'] > low_thr
            if c1 and (c2a or c2b) and c3:
                vol_text = f"阴线均量 {dvr:.2f}×均量（门槛 ≥{vol_thr}×）" if c2a else ""
                if c2b:
                    vol_text = (vol_text + "；") if vol_text else ""
                    vol_text += f"放量破位距今仅 {fresh} 个交易日（≤{fresh_days_max} 天）"
                out.append(hit("B_R1", "持续创新低 + 放量杀跌，处于破位杀跌初期，暂不纳入 B 池", "auto",
                               f"近 {win} 根已 {nl60} 次创 {pget('retrace_lookback', 60)} 日新低（门槛 ≥{min_cnt} 次）；"
                               f"{vol_text}；现价距 60 日最低仍 {ind['dist_to_low_pct']:.1f}%（超过 {low_thr}%）"))
        # B_R2 上方套牢峰过近（东财筹码近似 + 人工确认）
        if ctx['enabled'].get('B_R2', True):
            chip = ctx.get('chip') or {}
            dist = chip.get('pressure_dist_pct')
            if dist is not None and dist < float(pget('chip_pressure_dist_min_pct', 5.0)):
                out.append(hit("B_R2", "上方密集套牢峰很近，反弹马上就到巨大抛压区", "semi",
                               f"90% 筹码上沿 {chip.get('cost_90_upper')}，距现价仅 {dist:.1f}%（门槛 {pget('chip_pressure_dist_min_pct',5)}%，东财口径近似）"))
        # B_R3 无量拉升 / 板块资金退潮
        if ctx['enabled'].get('B_R3', True):
            reasons = []
            if ind['today_pct'] is not None and ind['today_pct'] > float(pget('b_lift_min_pct', 2.0)) \
                    and ind['vol_ratio_est'] < float(pget('b_weak_vol_ratio', 0.8)):
                reasons.append(f"涨 {ind['today_pct']:.2f}% 但折算量仅 {ind['vol_ratio_est']:.2f}×均量（无量拉升）")
            ebb = (ctx.get('sector_flow') or {}).get('ebb')
            if pget('sector_ebb_check', True) and ebb is True:
                sf = ctx['sector_flow']
                reasons.append(f"板块资金退潮：今日净流入 {sf.get('net_inflow_yi')} 亿 < 近 5 日均值 {sf.get('avg_5d_yi')} 亿")
            if reasons:
                out.append(hit("B_R3", "无量拉升、虚放量，板块资金快速退潮", "auto", "；".join(reasons)))
        # B_R4 今日涨幅超限
        if ctx['enabled'].get('B_R4', True) and ind['today_pct'] is not None:
            lim = float(pget('b_max_today_pct', 5.0))
            if ind['today_pct'] > lim:
                out.append(hit("B_R4", "盘中不满足你的分时、涨幅限制", "semi",
                               f"今日涨幅 {ind['today_pct']:.2f}% > 反弹票上限 {lim}%（赔率已失）"))
        # B_R5 下跌中继
        if ctx['enabled'].get('B_R5', True):
            reasons = []
            if ind['new_low_count'] >= int(pget('b_new_low_count', 3)):
                reasons.append(f"近 {pget('b_new_low_window',5)} 日第 {ind['new_low_count']} 次创 20 日新低")
            if ind['today_new_low20']:
                reasons.append("今日仍创 20 日新低")
            if ind['ma_short_v'] and price < ind['ma_short_v'] and ind['ma_short_prev'] and ind['ma_short_v'] < ind['ma_short_prev']:
                reasons.append(f"现价 {price:.2f} < MA{pget('ma_short',5)} {ind['ma_short_v']:.2f} 且 5 日线仍向下")
            if reasons:
                out.append(hit("B_R5", "属于下跌中继，不断创新低，没有止跌信号", "auto", "；".join(reasons)))
    return out, marks


def score_A(df, ind, ctx):
    """A 池 8 项自动打分"""
    items = []
    last = df.iloc[-1]
    price = ind['price']

    def add(code, label, met, detail):
        items.append({"code": code, "label": label, "met": bool(met), "detail": detail})

    add("A_S1", "道氏上升趋势成立", ind['dow'] == 'UP', f"道氏判定={ind['dow']}（{pget('n_day_high_low',20)} 日 {pget('dow_segments',3)} 段高低点）")
    ok2 = bool(ind['ma_mid_v'] and ind['ma_mid_prev'] and ind['ma_mid_v'] > ind['ma_mid_prev'] and price > ind['ma_mid_v'])
    add("A_S2", f"{pget('ma_mid',20)} 日线向上且价格站上", ok2,
        f"现价 {price:.2f} vs MA{pget('ma_mid',20)} {ind['ma_mid_v'] or 0:.2f}（{(price/ind['ma_mid_v']-1)*100:+.1f}%，均线{'向上' if ind['ma_mid_v'] and ind['ma_mid_prev'] and ind['ma_mid_v']>ind['ma_mid_prev'] else '走平/向下'}）")
    ok3 = bool(ind['ma_short_v'] and ind['ma_mid_v'] and ind['ma_long_v'] and ind['ma_short_v'] > ind['ma_mid_v'] > ind['ma_long_v'])
    add("A_S3", "均线多头排列", ok3, f"MA{pget('ma_short',5)}={ind['ma_short_v'] or 0:.2f} / MA{pget('ma_mid',20)}={ind['ma_mid_v'] or 0:.2f} / MA{pget('ma_long',30)}={ind['ma_long_v'] or 0:.2f}")
    ok4 = bool(ind['adx'] and ind['adx'] > float(pget('adx_trend_threshold', 25)) and ind['pdi'] and ind['pdi'] > (ind['mdi'] or 0))
    add("A_S4", "ADX 多头趋势强度达标", ok4, f"ADX={ind['adx'] or 0:.1f}（门槛 {pget('adx_trend_threshold',25)}），PDI={ind['pdi'] or 0:.1f} vs MDI={ind['mdi'] or 0:.1f}")
    ok5 = ind['vol_ratio_est'] >= float(pget('vol_expand_ratio', 1.1))
    add("A_S5", "今日放量", ok5, f"折算全天量={ind['vol_ratio_est']:.2f}×{pget('vol_ma_period',20)}日均量（原始累计 {ind['vol_ratio_raw']:.2f}×，折算系数 {ind['vol_scale']:.3f}），门槛 {pget('vol_expand_ratio',1.1)}×")
    ok6 = bool(ind['recent_low'] and last['low'] > ind['recent_low'] * (1 - float(pget('low_streak_tolerance', 3.0)) / 100))
    add("A_S6", "短期不再持续创新低", ok6, f"今日最低 {last['low']:.2f} vs 近 {pget('low_streak_window',10)} 日最低 {ind['recent_low'] or 0:.2f}")
    add("A_S7", "价格靠近斐波那契支撑", ind['fib_near'], ("靠近 " + str(ind['fib_info'].get('near'))) if ind['fib_near'] else
        f"距 382={ind['fib_info'].get('fib382')} / 500={ind['fib_info'].get('fib500')} / 618={ind['fib_info'].get('fib618')} 均超 {pget('fib_near_pct',3)}%")
    stale = (ind['today_pct'] is not None and ind['today_pct'] > float(pget('stale_high_max_pct', 1.0))
             and ind['vol_ratio_est'] >= float(pget('stale_high_vol_ratio', 2.0)) and price >= ind['high20'] * 0.995)
    add("A_S8", "无高位放量滞涨", not stale, "提示：巨量滞涨且处 20 日高位" if stale else f"涨幅 {ind['today_pct'] or 0:.2f}%，折算量 {ind['vol_ratio_est']:.2f}×，无滞涨特征")
    return items


def score_B(df, ind, ctx):
    """B 池 7 项自动打分"""
    items = []
    last = df.iloc[-1]
    vma_prev = ind['vol_ma_prev']

    def add(code, label, met, detail):
        items.append({"code": code, "label": label, "met": bool(met), "detail": detail})

    add("B_S1", "回撤充分（跌透了）", ind['retrace_pct'] is not None and ind['retrace_pct'] >= float(pget('retract_min', 20.0)),
        f"60 日回撤 {ind['retrace_pct'] or 0:.1f}%（门槛 {pget('retract_min',20)}%），高 {ind['high60'] or 0:.2f} → 低 {ind['low60'] or 0:.2f}")
    ok2 = (ind['vol_prev_ratio'] is not None and ind['vol_prev_ratio'] < float(pget('vol_shrink_ratio', 0.7))
           and ind['vol_ratio_est'] > float(pget('vol_start_ratio', 1.2)))
    add("B_S2", "前一日缩量 + 今日放量启动", ok2,
        f"昨日量={ind['vol_prev_ratio'] if ind['vol_prev_ratio'] is None else round(ind['vol_prev_ratio'],2)}×均量（门槛 <{pget('vol_shrink_ratio',0.7)}×），今日折算={ind['vol_ratio_est']:.2f}×（门槛 >{pget('vol_start_ratio',1.2)}×）")
    ok3 = bool(ind['recent_low'] and last['low'] > ind['recent_low'] * (1 - float(pget('low_streak_tolerance', 3.0)) / 100))
    add("B_S3", "停止持续创新低", ok3, f"今日最低 {last['low']:.2f} vs 近 {pget('low_streak_window',10)} 日最低 {ind['recent_low'] or 0:.2f}")
    fresh_break = (ind['today_pct'] is not None and ind['today_pct'] < -float(pget('b_fresh_break_drop_pct', 8.0))
                   and ind['vol_ratio_est'] >= float(pget('stale_high_vol_ratio', 2.0)))
    add("B_S4", "不是刚破位暴跌", not fresh_break, "警告：当日放量大跌破位" if fresh_break else
        f"当日 {ind['today_pct'] or 0:+.2f}%，折算量 {ind['vol_ratio_est']:.2f}×")
    add("B_S5", "价格靠近斐波那契支撑", ind['fib_near'], ("靠近 " + str(ind['fib_info'].get('near'))) if ind['fib_near'] else
        f"382={ind['fib_info'].get('fib382')} / 500={ind['fib_info'].get('fib500')} / 618={ind['fib_info'].get('fib618')}，无支撑依托")
    mom_drop = None
    if ind['close_n_ago']:
        mom_drop = (1 - last['close'] / ind['close_n_ago']) * 100
    add("B_S6", "短期下跌动量放缓", mom_drop is not None and mom_drop <= float(pget('b_momentum_max_drop', 6.0)),
        f"近 {pget('b_momentum_window',5)} 日跌幅 {mom_drop if mom_drop is None else round(mom_drop,1)}%（门槛 ≤{pget('b_momentum_max_drop',6)}%）")
    add("B_S7", "无极端爆量", ind['vol_ratio_est'] <= float(pget('extreme_vol_ratio', 3.5)),
        f"折算量 {ind['vol_ratio_est']:.2f}×均量（上限 {pget('extreme_vol_ratio',3.5)}×）")
    return items


# ============================================================ 画图数据

def build_kline_payload(df, ind, marks, overlays_meta, display_days):
    """输出前端 ECharts 需要的序列与标注"""
    tail = df.tail(int(display_days))
    idx = tail.index
    bars, dates = [], []
    for i in idx:
        r = df.loc[i]
        dates.append(str(r['date']))
        bars.append([rnd(r['open'], 3), rnd(r['close'], 3), rnd(r['low'], 3), rnd(r['high'], 3),
                     rnd(r['volume'], 0), rnd(r['amount'], 0), rnd(r.get('turnover'), 2), rnd(r.get('pct'), 2)])
    series = {
        f"ma{p}": [rnd(df.loc[i, f'ma{p}'], 3) if f'ma{p}' in df.columns else None for i in idx]
        for p in (pget('ma_short', 5), pget('ma_mid', 20), pget('ma_long', 30))
    }
    return {
        "dates": dates,
        "bars": bars,               # [开,收,低,高,量,额,换手,涨跌幅]
        "ma": series,
        "volume": [rnd(df.loc[i, 'volume'], 0) for i in idx],
        "macd": {"dif": [rnd(df.loc[i, 'dif'], 4) for i in idx],
                 "dea": [rnd(df.loc[i, 'dea'], 4) for i in idx],
                 "bar": [rnd(df.loc[i, 'macd'], 4) for i in idx]},
        "marks": marks,
        "overlays": overlays_meta,
        "today_live": bool(ind.get('is_live')),
        "vol_scale": rnd(ind.get('vol_scale'), 4),
        "panel": {
            "price": rnd(ind['price'], 3),
            "ma_short": rnd(ind['ma_short_v'], 3), "ma_mid": rnd(ind['ma_mid_v'], 3), "ma_long": rnd(ind['ma_long_v'], 3),
            "adx": rnd(ind['adx'], 2), "pdi": rnd(ind['pdi'], 2), "mdi": rnd(ind['mdi'], 2),
            "vol_ratio_raw": rnd(ind['vol_ratio_raw'], 2), "vol_ratio_est": rnd(ind['vol_ratio_est'], 2),
            "retrace_pct": rnd(ind['retrace_pct'], 1), "dist_to_low_pct": rnd(ind['dist_to_low_pct'], 1),
            "high60": rnd(ind['high60'], 3), "low60": rnd(ind['low60'], 3), "high20": rnd(ind['high20'], 3),
            "fib": ind['fib_info'], "dow": ind['dow'],
        },
    }


# ============================================================ 主流程：打分

def run_score(args, now):
    today_str = bj_date_str(now)
    elapsed, vol_scale = trading_minutes(now)
    snap = getattr(args, 'snapshot', None) or {}
    sectors_arg = [s.strip() for s in (args.sectors or '').split(',') if s.strip()]
    symbols_arg = [s.strip() for s in (args.symbols or '').split(',') if s.strip()]

    progress(0, 4, "拉取板块资金流")
    if snap.get('on'):
        # 快照模式：不请求板块资金流（只定格个股当时口径），板块相关项按数据缺失计
        sector_rows, sec_meta = [], {'sector_flow_skipped': '快照模式不请求板块资金流，板块共振/退潮相关项按数据缺失计'}
    else:
        # 候选清单已确定（--symbols）时板块资金流只是加分项，取不到不致命（板块接口被限流时仍可打分）
        sector_rows, sec_meta = fetch_sector_flow(now, soft=bool(symbols_arg))
    sector_map = {r['name']: r for r in sector_rows}

    # 候选清单：显式 symbols 优先（页面确认过的结果），否则自动取板块成分
    pairs = []
    if symbols_arg:
        for item in symbols_arg:
            code, _, sec = item.partition(':')
            code = code.strip()
            if len(code) == 6 and code.isdigit():
                pairs.append((code, (sec.strip() or '人工自选')))
    else:
        progress(1, 4, "拉取板块成分股")
        top_n = int(pget('top_sectors', 3))
        chosen = sectors_arg or [r['name'] for r in sector_rows[:top_n]]
        boards, _ = fetch_industry_boards()
        for name in chosen:
            matched = [name] if name in boards or not boards else fuzzy_match_sector(name, boards)[:1]
            for m in matched:
                pace()
                cons, err = fetch_constituents(m)
                if err:
                    continue
                ccol, ncol, pcol = pick_col(cons, '代码'), pick_col(cons, '名称'), pick_col(cons, '涨跌幅')
                if not ccol:
                    continue
                for _, r in cons.iterrows():
                    code = str(r[ccol]).strip()
                    if len(code) == 6 and code.isdigit():
                        pairs.append((code, m))

    # 去重（保留首次出现的板块归属）
    uniq, seen = [], set()
    for code, sec in pairs:
        if code not in seen:
            seen.add(code)
            uniq.append((code, sec))

    progress(2, 4, "拉取实时行情快照")
    # 数据源：逐只日线与快照默认走新浪（每股 1 次，不重试），不再把请求全压在东财；东财只在新浪挂时回落
    source = (getattr(args, 'source', 'sina') or 'sina')
    spot_missing = []
    spot_map = {}
    if snap.get('on'):
        # 快照自己造 spot（盘中由分时还原，收盘直接用该日定型 K），不再请求实时快照接口
        sec_meta['spot_source'] = 'snapshot'
    elif source == 'sina':
        spot_map, spot_missing = sina_spot([c for c, _ in uniq])
        if spot_map:
            sec_meta['spot_source'] = 'sina'
        else:
            progress(2, 4, "新浪快照未返回，回落东财全市场快照")
            spot_map = fetch_spot_map(now)
    else:
        spot_map = fetch_spot_map(now)
        sec_meta['spot_source'] = 'em'

    # 板块归属修正 + 过滤
    filtered = []
    drop_reasons = {}
    for code, sec in uniq:
        info = spot_map.get(code) or {}
        name = info.get('name') or snap.get('name') or ''
        if pget('filter_st', True) and ('ST' in name.upper()):
            drop_reasons[code] = "ST 股过滤"
            continue
        if pget('filter_bse', False) and code[0] in ('4', '8', '9'):
            drop_reasons[code] = "北交所过滤"
            continue
        if pget('filter_star', False) and code.startswith('688'):
            drop_reasons[code] = "科创板过滤"
            continue
        if pget('filter_cyb', False) and code.startswith(('300', '301')):
            drop_reasons[code] = "创业板过滤"
            continue
        filtered.append((code, sec, name))

    cap = int(pget('max_candidates_per_run', 120))
    if len(filtered) > cap:
        filtered.sort(key=lambda x: -((spot_map.get(x[0]) or {}).get('pct') or -99))
        drop_reasons.update({c: f"超出单次上限 {cap} 只，按涨幅截断" for c, _, _ in filtered[cap:]})
        filtered = filtered[:cap]

    progress(3, 4, "逐只拉取日线并计算指标")
    results, skipped, errors = [], [], []
    total = len(filtered)
    ma_periods = sorted({int(pget('ma_short', 5)), int(pget('ma_mid', 20)), int(pget('ma_long', 30))})
    chip_budget = 0 if getattr(args, 'no_chip', False) else int(pget('chip_probe_limit', 20) or 0)
    with_minutes = bool(getattr(args, 'with_minutes', False))

    for i, (code, sec, name) in enumerate(filtered, 1):
        progress(i, total, f"打分 {name or code}（{i}/{total}）")
        pace()
        df, err = load_daily(code, args.end_date or today_str, source)
        if err:
            errors.append({"symbol": code, "name": name, **err})
            skipped.append({"symbol": code, "name": name, "reason": "日线接口失败：" + err['error']})
            continue
        if args.end_date:
            # 新浪日线只给最近 N 根 → 快照/补历史必须按结束日本地截断（东财接口本身已按日期取，再截一次无害）
            df = df[df['date'] <= args.end_date].reset_index(drop=True)
        need = int(pget('min_bars_required', 60))
        if len(df) < need:
            skipped.append({"symbol": code, "name": name, "reason": f"上市/可取日线仅 {len(df)} 根，不足 {need} 根" if pget('filter_new_stock', True)
                                                                     else f"日线仅 {len(df)} 根"})
            continue
        if snap.get('on') and str(df['date'].iloc[-1]) != today_str:
            emit_error('snapshot', f"{today_str} 没有 {code} 的日线数据（非交易日或长期停牌），最近可用的交易日是 {df['date'].iloc[-1]}。",
                       f"as_of={today_str} last_bar={df['date'].iloc[-1]}")

        spot = spot_map.get(code) or {}
        snap_minutes = None
        if snap.get('on') and snap.get('asof_time'):
            # 盘中快照：用分时还原「截至该时刻的当日临时 K」；取不到分时直接中文报错，不静默降级成收盘口径
            day_open = num(df[df['date'] == today_str]['open'].iloc[0])
            pts_info, perr = sina_minutes_day(code, today_str, fine_first=(today_str >= bj_date_str(now)))
            if perr:
                emit_error('snapshot', f"{code} 的 {today_str} 盘中快照取不到：{perr['error']}", perr.get('raw', ''))
            built, snap_minutes = build_asof_spot(pts_info, today_str, snap['asof_time'], day_open,
                                                 num(df['close'].iloc[-2]) if len(df) > 1 else None)
            if not built:
                emit_error('snapshot', f"{code} 的 {today_str} 盘中快照取不到：{snap_minutes}",
                           f"as_of_time={snap['asof_time']}，分时周期 {pts_info['scale']} 分钟")
            spot = built
            # 5 分钟分时可能只到 09:55，量能折算按实际截断时刻算，别把未走的分钟也算进去
            cut_at = datetime.strptime(f"{today_str} {spot['last_time']}", '%Y-%m-%d %H:%M')
            elapsed, vol_scale = trading_minutes(cut_at)
            snap['actual_time'] = spot['last_time']
            snap['minute_scale'] = pts_info['scale']
            snap['minute_days'] = pts_info['days']
        df, is_live = merge_live_bar(df, spot, today_str, elapsed)
        data_as_of = str(df['date'].iloc[-2] if is_live else df['date'].iloc[-1])

        df = add_ma(df, ma_periods)
        df = calc_adx(df, pget('n_adx', 14), pget('n_adx_smooth', 6))
        df = calc_macd(df)
        vol_col = 'volume'
        df['vma'] = df[vol_col].rolling(int(pget('vol_ma_period', 20))).mean()
        last = df.iloc[-1]

        # ---- 量能折算
        vma = num(df['vma'].iloc[-1])
        vma_prev = num(df['vma'].iloc[-2]) if len(df) > 1 else None
        raw_vol = num(last[vol_col]) or 0
        prev_vol = num(df[vol_col].iloc[-2]) if len(df) > 1 else 0
        est_vol = raw_vol / vol_scale if (is_live and vol_scale > 0) else raw_vol
        vol_ratio_est = (est_vol / vma) if vma else 0
        vol_ratio_raw = (raw_vol / vma) if vma else 0
        vol_prev_ratio = (prev_vol / vma_prev) if vma_prev else None

        price = num(last['close'])
        dow, dow_marks = dow_trend(df, pget('n_day_high_low', 20), pget('dow_segments', 3))
        fib_near, fib_info = calc_fib(df, pget('fib_lookback', 60), pget('fib_near_pct', 3.0))
        sub60 = df.tail(int(pget('retrace_lookback', 60)))
        high60, low60 = num(sub60['high'].max()), num(sub60['low'].min())
        retrace_pct = (high60 - low60) / high60 * 100 if high60 else None
        dist_to_low_pct = (price - low60) / low60 * 100 if (low60 and price) else None
        low20_series = df['low'].rolling(20).min()
        nl_count, today_new_low = 0, False
        w = int(pget('b_new_low_window', 5))
        for j in range(max(0, len(df) - w), len(df)):
            if num(low20_series.iloc[j]) is not None and num(df['low'].iloc[j]) <= num(low20_series.iloc[j]) * 1.001:
                nl_count += 1
        if num(low20_series.iloc[-1]) is not None and num(last['low']) <= num(low20_series.iloc[-1]) * 1.001:
            today_new_low = True
        # 放量破位距今天数
        fresh_days = None
        break_thr = -float(pget('b_fresh_break_drop_pct', 8.0))
        for j in range(1, min(21, len(df))):
            idx = len(df) - j
            row_pct = num(df['pct'].iloc[idx])
            row_ratio = (num(df[vol_col].iloc[idx]) / num(df['vma'].iloc[idx])) if num(df['vma'].iloc[idx]) else 0
            if row_pct is not None and row_pct <= break_thr and row_ratio >= float(pget('stale_high_vol_ratio', 2.0)):
                fresh_days = j - 1
                break

        # ---- 红线 B_R1 组合条件：窗口内创 60 日新低次数 + 阴线平均量倍数（盘中末根先按折算量）
        r1_win = max(1, int(pget('b_r1_new_low_window', 10)))
        prior_low = df['low'].shift(1).rolling(max(1, int(pget('retrace_lookback', 60)) - 1), min_periods=1).min()
        vol_adj = df[vol_col].astype(float).copy()
        if is_live and len(vol_adj):
            vol_adj.iloc[-1] = est_vol
        nl60_count, nl60_last_ago, down_vols = 0, None, []
        for j in range(max(0, len(df) - r1_win), len(df)):
            pl = num(prior_low.iloc[j])
            pj_low = num(df['low'].iloc[j])
            if pl is not None and pj_low is not None and pj_low <= pl * 1.001:
                nl60_count += 1
                nl60_last_ago = len(df) - 1 - j
            if (num(df['pct'].iloc[j]) or 0) < 0:
                down_vols.append(num(vol_adj.iloc[j]) or 0)
        down_vol_ratio = rnd(sum(down_vols) / len(down_vols) / vma, 3) if (down_vols and vma) else None

        ind = {
            "price": price, "dow": dow, "is_live": is_live, "vol_scale": vol_scale,
            "today_pct": num(spot.get('pct')) if is_live else num(df['pct'].iloc[-1]),
            "ma_short_v": num(df[f"ma{pget('ma_short',5)}"].iloc[-1]), "ma_short_prev": num(df[f"ma{pget('ma_short',5)}"].iloc[-2]) if len(df) > 1 else None,
            "ma_mid_v": num(df[f"ma{pget('ma_mid',20)}"].iloc[-1]), "ma_mid_prev": num(df[f"ma{pget('ma_mid',20)}"].iloc[-2]) if len(df) > 1 else None,
            "ma_long_v": num(df[f"ma{pget('ma_long',30)}"].iloc[-1]),
            "adx": num(df['adx'].iloc[-1]), "pdi": num(df['pdi'].iloc[-1]), "mdi": num(df['mdi'].iloc[-1]),
            "vol_ma": vma, "vol_ma_prev": vma_prev, "vol_ratio_raw": vol_ratio_raw, "vol_ratio_est": vol_ratio_est,
            "vol_prev_ratio": vol_prev_ratio, "raw_volume": raw_vol, "est_volume": est_vol,
            "recent_low": num(df['low'].tail(int(pget('low_streak_window', 10))).min()),
            "high20": num(df['high'].tail(20).max()), "high60": high60, "low60": low60,
            "retrace_pct": retrace_pct, "dist_to_low_pct": dist_to_low_pct,
            "fib_near": fib_near, "fib_info": fib_info,
            "close_n_ago": num(df['close'].iloc[-int(pget('b_momentum_window', 5)) - 1]) if len(df) > int(pget('b_momentum_window', 5)) else None,
            "new_low_count": nl_count, "today_new_low20": today_new_low, "fresh_break_days_ago": fresh_days,
            "new_low60_count": nl60_count, "new_low60_last_ago": nl60_last_ago, "down_vol_ratio": down_vol_ratio,
        }

        ctx = {
            "enabled": args.enabled_map,
            "chip": None,
            "sector_flow": sector_map.get(sec),
            "divergence": None,
        }

        pool = 'A' if dow == 'UP' else 'B'

        # 筹码近似（仅 B 池、预算内、逐只 1 次调用；失败不影响主流程）
        if pool == 'B' and chip_budget > 0:
            chip_budget -= 1
            pace()
            cdf, cerr = safe_call(f"筹码分布[{code}]", ak.stock_cyq_em, symbol=code, adjust="qfq")
            if cerr is None:
                ucol = pick_col(cdf, '成本-高', '90成本-高')
                pcol = pick_col(cdf, '获利比例', '获利')
                dcol = pick_col(cdf, '日期')
                if ucol is not None:
                    row_last = cdf.iloc[-1]
                    upper = num(row_last[ucol])
                    chip = {
                        "cost_90_upper": rnd(upper, 2),
                        "profit_ratio": num(row_last[pcol]) if pcol else None,
                        "as_of": str(row_last[dcol]) if dcol else None,
                        "source": "东方财富 stock_cyq_em（近似，非同花顺 Level2）",
                    }
                    chip['pressure_dist_pct'] = rnd((upper - price) / price * 100, 2) if (upper and price) else None
                    ctx['chip'] = chip
            else:
                ctx['chip'] = {"source": "筹码接口本次未返回，B_R2 转人工判定", "pressure_dist_pct": None}

        red_lines, marks = check_redlines(df, ctx, pool, ind)
        marks = marks + dow_marks

        if pool == 'A':
            items = score_A(df, ind, ctx)
        else:
            items = score_B(df, ind, ctx)

        # 只统计规则表里 enabled 的打分项（满分随启用项个数变化）
        enabled_items = [x for x in items if ctx['enabled'].get(x['code'], True) is not False]
        auto_score = sum(1 for x in enabled_items if x['met'])
        failed = [x for x in enabled_items if not x['met']]
        weakest = failed[0]['detail'] if failed else ''

        # 追高偏离：可选预警（不属用户给定红线，不进列淘汰，单独放 warnings）
        warnings_list = []
        if pool == 'A' and pget('a_overextend_enabled', False) and ind['ma_mid_v'] and price:
            dev = (price - ind['ma_mid_v']) / ind['ma_mid_v'] * 100
            if dev > float(pget('a_overextend_ma20_pct', 15.0)):
                warnings_list.append({
                    "code": "A_OPT",
                    "label": "追高偏离预警（可选规则，默认关闭）",
                    "detail": f"现价高于 MA{pget('ma_mid',20)} {dev:.1f}% > {pget('a_overextend_ma20_pct',15)}%，建议等回踩",
                })

        # B_R1 只过滤还在杀跌的票：已止跌但距低点仍偏高的，降级为普通预警展示，不再一票淘汰
        if pool == 'B' and not any(r.get('code') == 'B_R1' for r in red_lines):
            low_thr = float(pget('b_dist_to_low_max', 15.0))
            if ind['dist_to_low_pct'] is not None and ind['dist_to_low_pct'] > low_thr:
                warnings_list.append({
                    "code": "B_R1_INFO",
                    "label": "距 60 日最低仍偏高（未触发 B_R1 淘汰）",
                    "detail": f"现价距 60 日最低 {ind['dist_to_low_pct']:.1f}%（>{low_thr}%），但近 {pget('b_r1_new_low_window',10)} 根仅 {ind.get('new_low60_count') or 0} 次创新低、"
                              f"阴线均量 {('%.2f' % ind['down_vol_ratio']) if ind.get('down_vol_ratio') is not None else '—'}×均量，"
                              f"不再判为杀跌初期；是否介入交给人工继续评估",
                })

        overlays = ["ma" if pool == 'A' else "retrace", "dow_points", "fib", "fail_dots", "today_bar"]
        if pool == 'A':
            overlays.append("divergence")
        if any(m.get("kind") == "neckline" for m in marks):
            overlays.append("neckline")
        for x in failed:
            marks.append({"date": str(last['date']), "kind": "fail", "text": f"{x['code']} {x['label']}"})
        for r in red_lines:
            marks.append({"date": str(last['date']), "kind": "redline", "text": f"🚫{r['code']}"})

        # 脚本命中的红线（无论 auto 还是 semi）均直接淘汰；semi 表示人工还可能补充判定
        eliminated = len(red_lines) > 0

        results.append({
            "symbol": code,
            "name": name or (spot.get('name') or ''),
            "sector": sec,
            "pool_type": pool,
            "today_pct": rnd(ind['today_pct'], 2),
            "auto_score": auto_score,
            "max_auto_score": len(enabled_items),
            "score_detail": enabled_items,
            "red_lines": red_lines,
            "eliminated": eliminated,
            "warnings": warnings_list,
            "dow_trend": dow,
            "retrace": rnd((retrace_pct or 0) / 100, 4),
            "fib_info": fib_info,
            "indicators": {k: (rnd(v, 4) if isinstance(v, (int, float)) else v) for k, v in ind.items() if k != 'fib_info'},
            # 招财进宝 M3~M8 原始判定：只在后端下发 fp_compute=true 时算（追资金不开、零开销），
            # 本脚本不算分也不读权重，只交「事实 + 命中」，分值/权重在后端 fortune_criteria.json 折算
            "fortune_modules": (fortune_modules(df, ind) if pget('fp_compute', False) else None),
            # 衰竭止盈 W1~W8（卖出分）：fp_sell_compute=true（招财进宝下发）才算，同样只交事实与命中，分值在 Node 折算
            "sell_modules": (sell_modules(df, ind) if pget('fp_sell_compute', False) else None),
            "chip": ctx.get('chip'),
            "fund_flow": {
                "sector_today_net": (sector_map.get(sec) or {}).get('net_inflow_yi'),
                "sector_5d_avg_net": (sector_map.get(sec) or {}).get('avg_5d_yi'),
                "sector_ebb": (sector_map.get(sec) or {}).get('ebb'),
            },
            "weakest_gap": weakest,
            "suggest_hold": ("优先 2～3 天，趋势强劲可 4～5 天，沿均线移动止盈" if pool == 'A'
                              else "优先 1～2 天，不拖到 4～5 天，靠近压力主动止盈"),
            "data_as_of": data_as_of,
            "kline": build_kline_payload(df, ind, marks, overlays, pget('kline_days', 120)),
            "manual_check_codes": [],
        })

        # 单只详情额外附分时（仅 --with-minutes，1 只 1 次请求，批量跑时不走）
        if with_minutes and results:
            pts, prev_close, period, min_date = sina_minutes(code)
            results[-1]['minutes'] = pts
            results[-1]['minutes_period_min'] = period
            results[-1]['minutes_date'] = min_date
            results[-1]['prev_close'] = prev_close or (spot_map.get(code) or {}).get('prev_close')
            results[-1]['spot_time'] = ((spot_map.get(code) or {}).get('last_date') or '') + ' '\
                + ((spot_map.get(code) or {}).get('last_time') or '')
        elif snap.get('on') and snap_minutes and results:
            # 盘中快照已经拉过分时（没再花请求），附带截至时刻之前的分时点给页面画「当时的分时」
            results[-1]['minutes'] = snap_minutes
            results[-1]['minutes_period_min'] = snap.get('minute_scale')
            results[-1]['minutes_date'] = today_str
            results[-1]['prev_close'] = num(df['close'].iloc[-2]) if len(df) > 1 else None
            results[-1]['spot_time'] = f"{today_str} {snap.get('actual_time') or snap['asof_time']}"

    progress(4, 4, "完成")
    payload = {
        "ok": True,
        "action": "snapshot" if snap.get('on') else "score",
        "meta": {
            "trade_date": today_str,
            "run_time": now.strftime('%H:%M'),
            "snapshot": (snap or None) if snap.get('on') else None,
            "data_as_of": results[0]['data_as_of'] if results else None,
            "intraday": 0 < elapsed < TOTAL_TRADING_MIN,
            "elapsed_trading_min": elapsed,
            "vol_scale": rnd(vol_scale, 4),
            "sector_source": pget('sector_source'),
            "data_source": {"daily": source, "spot": sec_meta.get('spot_source') or 'em'},
            "spot_missing": spot_missing[:20],
            "sectors": [dict(sector_map[s], name=s) for s in sorted({r['sector'] for r in results}) if s in sector_map],
            "filters": {k: pget(k) for k in ('filter_st', 'filter_new_stock', 'filter_bse', 'filter_star', 'filter_cyb')},
            "warnings": [w for w in (
                ("板块资金流今日数据未取到（接口限流或异常），板块共振/退潮相关项按数据缺失计：" + sec_meta['sector_flow_error'])
                if sec_meta.get('sector_flow_error') else None,
                sec_meta.get('sector_5d_error'),
            ) if w],
        },
        "stocks": results,
        "skipped": skipped + [{"symbol": k, "name": '', "reason": v} for k, v in drop_reasons.items()],
        "errors": errors[:20],
        "stats": {
            "candidate_total": len(filtered),
            "success": len(results),
            "skipped": len(skipped) + len(drop_reasons),
            "failed": len(errors),
            "eliminated": sum(1 for r in results if r['eliminated']),
            "with_redline": sum(1 for r in results if r['red_lines']),
        },
    }
    text = json.dumps(clean(payload), ensure_ascii=False)
    if args.out:
        with open(args.out, 'w', encoding='utf-8') as f:
            f.write(text)
        print(json.dumps({"ok": True, "action": "score", "out": args.out, "stats": payload['stats'],
                          "meta": payload['meta']}, ensure_ascii=False))
    else:
        print(text)


def run_analyze(args, now):
    """
    单只票详情分析（页面点股票名）：直接复用 run_score 整条流水线，候选清单只有这 1 只，
    保证判定口径与批次打分完全一致（另写一套 JS 规则只会两套口径互相漂移）。
    请求数：日线 1 次（新浪）+ 快照 1 次 + 分时 1 次 = 3 次，全部不重试；筹码默认不查（那是东财接口）。
    """
    code = str(args.symbol or '').strip()
    if code[:2] in ('sh', 'sz', 'bj'):
        code = code[2:]
    if len(code) != 6 or not code.isdigit():
        emit_error('analyze', '请提供 6 位股票代码（例如 002913）。', f"symbol={args.symbol}")
    args.symbols = f"{code}:{args.sector or '人工自选'}"
    args.sectors = args.sector or ''
    args.out = ''                     # 结果直接打 stdout，由后端取 stocks[0]
    args.with_minutes = True
    args.no_chip = not bool(getattr(args, 'with_chip', False))
    run_score(args, now)


def run_snapshot(args, now):
    """
    定格快照（录入基准 / 复盘）：把「指定时间点为止的 K 线状态」跑完整条判定流水线，
    结果作为当时的选股依据固定存档，不随后续新增 K 线重算。
      --as-of 2026-11-09         快照日期（默认今天）
      --as-of-time 10:00         不给或给 15:00 = 当日收盘定型 K；给了盘中时刻 = 用分时还原到那一刻的临时 K
    请求数：收盘口径 1 次（新浪日线）；盘中口径 2 次（日线 1 + 分时 1~2），全部不重试。
    判定口径与批次打分、单票分析完全一致（同一个 check_redlines + score_A/B）。
    """
    code = str(args.symbol or '').strip()
    if code[:2] in ('sh', 'sz', 'bj'):
        code = code[2:]
    if len(code) != 6 or not code.isdigit():
        emit_error('snapshot', '请提供 6 位股票代码（例如 002913）。', f"symbol={args.symbol}")

    as_of = str(args.as_of or bj_date_str(now))[:10]
    hhmm = str(args.as_of_time or '').strip()
    try:
        as_of_dt = datetime.strptime(as_of, '%Y-%m-%d')
    except ValueError:
        emit_error('snapshot', '快照日期格式需为 YYYY-MM-DD。', f"as_of={args.as_of}")
    if as_of_dt.date() > now.date():
        emit_error('snapshot', f"快照日期 {as_of} 还没到，请选今天（{bj_date_str(now)}）或之前的交易日。", f"as_of={as_of}")

    intraday_cut = bool(hhmm) and hhmm not in ('15:00', '1500')
    if intraday_cut:
        try:
            t = datetime.strptime(hhmm, '%H:%M')
        except ValueError:
            emit_error('snapshot', '快照时刻格式需为 HH:MM（例如 10:00）；要收盘口径就不填时刻。', f"as_of_time={args.as_of_time}")
        mins = t.hour * 60 + t.minute
        if mins < 570 or mins > 900:
            emit_error('snapshot', '盘中快照的时刻要落在 9:30～15:00 之间（集合竞价前没有可比 K 线）。', f"as_of_time={hhmm}")
        as_of_dt = datetime.strptime(f"{as_of} {hhmm}", '%Y-%m-%d %H:%M')
    else:
        hhmm = ''
        as_of_dt = datetime.strptime(f"{as_of} 15:00", '%Y-%m-%d %H:%M')

    args.symbols = f"{code}:{args.sector or '人工自选'}"
    args.sectors = ''
    args.end_date = as_of
    args.out = ''
    args.with_minutes = False
    args.no_chip = not bool(getattr(args, 'with_chip', False))
    args.snapshot = {
        'on': True,
        'kind': 'intraday' if intraday_cut else 'close',
        'as_of_date': as_of,
        'asof_time': hhmm or None,
        'name': str(args.name or '')[:40],
    }
    run_score(args, as_of_dt)


def run_sectors(args):
    now = parse_now(args.now)
    rows, _ = fetch_sector_flow(now)
    top = int(pget('sector_display_count', 5))
    print(json.dumps(clean({"ok": True, "action": "sectors", "trade_date": bj_date_str(now),
                            "run_time": now.strftime('%H:%M'),
                            "intraday": 0 < trading_minutes(now)[0] < TOTAL_TRADING_MIN,
                            "sectors": rows[:top], "all_count": len(rows)}), ensure_ascii=False))


def run_constituents(args):
    now = parse_now(args.now)
    requested = [s.strip() for s in (args.sectors or '').split(',') if s.strip()]
    if not requested:
        emit_error("constituents", "未指定板块名，无法取成分股。", "sectors 参数为空")
    boards, berr = fetch_industry_boards()
    spot_map = fetch_spot_map(now)
    out, unmatched = [], []
    for name in requested:
        if boards and name not in boards:
            cands = fuzzy_match_sector(name, boards)
            if not cands:
                unmatched.append({"input": name, "suggestions": []})
                continue
            if name not in cands:
                unmatched.append({"input": name, "suggestions": cands})
                continue
        pace()
        cons, err = fetch_constituents(name)
        if err:
            out.append({"sector": name, "error": err['error'], "stocks": []})
            continue
        ccol, ncol = pick_col(cons, '代码'), pick_col(cons, '名称')
        stocks = []
        for _, r in cons.iterrows():
            code = str(r[ccol]).strip()
            if len(code) != 6 or not code.isdigit():
                continue
            info = spot_map.get(code) or {}
            stock_name = (str(r[ncol]).strip() if ncol else '') or info.get('name') or ''
            is_st = 'ST' in stock_name.upper()
            if pget('filter_st', True) and is_st:
                continue
            if pget('filter_bse', False) and code[0] in ('4', '8', '9'):
                continue
            if pget('filter_star', False) and code.startswith('688'):
                continue
            if pget('filter_cyb', False) and code.startswith(('300', '301')):
                continue
            stocks.append({
                "symbol": code,
                "name": stock_name,
                "sector": name,
                "today_pct": rnd(info.get('pct'), 2),
                "price": rnd(info.get('price'), 3),
                "amount_yi": rnd((info.get('amount') or 0) / 1e8, 2),
                "turnover": rnd(info.get('turnover'), 2),
                "vol_ratio": rnd(info.get('vol_ratio'), 2),
                "is_st": is_st,
                "board": ("科创板" if code.startswith('688') else "创业板" if code.startswith(('300', '301'))
                          else "北交所" if code[0] in ('4', '8', '9') else "主板"),
            })
        stocks.sort(key=lambda s: (s['today_pct'] is None, -(s['today_pct'] or 0)))
        out.append({"sector": name, "count": len(stocks), "stocks": stocks})
    print(json.dumps(clean({"ok": True, "action": "constituents", "boards": out,
                            "unmatched": unmatched,
                            "trade_date": bj_date_str(now),
                            "intraday": 0 < trading_minutes(now)[0] < TOTAL_TRADING_MIN,
                            "run_time": now.strftime('%H:%M')}), ensure_ascii=False))


# ============================================================ OUTPUT SCHEMA
"""
score 输出（写入 --out 文件）：
{
  "ok": true, "action": "score",
  "meta": { trade_date, run_time, data_as_of, intraday, elapsed_trading_min, vol_scale, sectors, warnings },

action=snapshot（定格快照，只 1 只）额外字段：
  meta.snapshot = { kind: 'intraday'|'close', as_of_date, asof_time, actual_time, minute_scale, minute_days[] }
  stocks[0].minutes / minutes_period_min / minutes_date / spot_time  （仅盘中口径，当时截至时刻之前的分时）
  "stocks": [{
     symbol, name, sector, pool_type('A'|'B'), today_pct,
     auto_score, max_auto_score, score_detail[{code,label,met,detail}],
     red_lines[{code,label,mode,detail}], eliminated,
     dow_trend, retrace, fib_info{}, indicators{}, chip{}, fund_flow{},
     fortune_modules{ module_code(volume_price/ma/dmi/fib/box/candle) :
            { model: 'accumulate'|'tier',
              items: [{id, met, type?, detail}],        # accumulate 给全部子项；tier 只给命中那一项
              state: '<命中档位 item id>'|null,          # tier 型专用；null = 数据不足，后端不把这个模块计入分母
              state_label?, facts{原始数值}, note? }
            仅 fp_compute=true（招财进宝下发）时非 null }
     sell_modules{ module_code(w1~w8) :
            { model: 'accumulate', applicable: true|false,   # false = 无清晰波段/箱体结构，本组不生效不计分
              items: [{id, met, detail}], facts{原始数值}, note? }
            仅 fp_sell_compute=true（招财进宝下发）时非 null；后端 foldSellModules 按库中分值折算衰竭总分 }
     weakest_gap, data_as_of, manual_check_codes[],
     kline{ dates[], bars[[开,收,低,高,量,额,换手,涨幅]], ma{ma5,ma20,ma30}, volume[], macd{},
            marks[{date,kind,price,text}], overlays[], today_live, vol_scale, panel{} }
  }],
  "skipped": [{symbol,name,reason}], "errors": [{symbol,label,error}],
  "stats": {candidate_total, success, skipped, failed, eliminated}
}
失败（stdout，exit 1）：{"ok": false, "action": "...", "error": "中文说明", "error_detail": "..."}
"""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--action', required=True, choices=['sectors', 'constituents', 'score', 'analyze', 'snapshot'])
    ap.add_argument('--symbol', default='')
    ap.add_argument('--sector', default='')
    # 快照参数（--action snapshot）：定格到哪天、哪天几点
    ap.add_argument('--as-of', default='')
    ap.add_argument('--as-of-time', default='')
    ap.add_argument('--name', default='')
    # 逐只日线与快照的数据源：sina（默认，避开东财限流）/ em（东财口径，含换手率与成交额）
    ap.add_argument('--source', default='sina', choices=['sina', 'em'])
    ap.add_argument('--with-minutes', action='store_true')
    ap.add_argument('--no-chip', action='store_true')
    ap.add_argument('--with-chip', action='store_true')
    ap.add_argument('--sectors', default='')
    ap.add_argument('--symbols', default='')
    ap.add_argument('--params-file', default='')
    ap.add_argument('--rules-file', default='')
    ap.add_argument('--out', default='')
    ap.add_argument('--now', default='')
    ap.add_argument('--end-date', default='')
    args = ap.parse_args()

    if args.params_file:
        try:
            with open(args.params_file, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
            if isinstance(loaded, dict):
                P.update({k: v for k, v in loaded.items() if v is not None})
        except Exception as e:  # noqa
            print(f"[WARN] 参数文件读取失败，使用内置默认：{e}", file=sys.stderr)

    # 打分项 / 红线启用状态（由后端从规则表下发）
    args.enabled_map = {}
    if args.rules_file:
        try:
            with open(args.rules_file, 'r', encoding='utf-8') as f:
                args.enabled_map = json.load(f)
        except Exception as e:  # noqa
            print(f"[WARN] 规则开关文件读取失败：{e}", file=sys.stderr)

    now = parse_now(args.now)
    if args.action == 'sectors':
        run_sectors(args)
    elif args.action == 'constituents':
        run_constituents(args)
    elif args.action == 'analyze':
        run_analyze(args, now)
    elif args.action == 'snapshot':
        run_snapshot(args, now)
    else:
        run_score(args, now)


if __name__ == '__main__':
    main()
