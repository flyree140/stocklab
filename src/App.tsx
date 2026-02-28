import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

// StockLab v12
// ✅ 把「模板」真正接進回測引擎（Backtest engine）
// - 策略模板：Trend (SMA) / Mean Reversion (RSI)
// - 支援：交易成本（fee+slippage）、ATR 停損、Volume gate、事件日曝險縮放（event scaling）
// - 指標：Total Return / CAGR / Sharpe / Max DD / Trades / Win rate
//
// Not Financial Advice.

type OHLCV = {
  t: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // shares
};

type NewsEvent = {
  seendate?: string;
  title: string;
  url: string;
  domain?: string;
  language?: string;
  sourceCountry?: string;
  tone?: number;
  score?: number;
};

type Provider = "auto" | "twse" | "stooq" | "server";

type StockOption = {
  value: string;
  label: string;
  defaultQuery: string;
  stooqSymbol?: string;
};

type InvestStyle = "long" | "swing" | "day";

type RiskLevel = "low" | "mid" | "high";

type FacetId = "technical" | "sentiment" | "macro" | "fundamental" | "flows" | "exogenous";

type EventLang = "any" | "chinese" | "english";

type EventCountry = "any" | "twn" | "usa" | "chn";

type AssetProfile = {
  trend: "up" | "down" | "side";
  trendStrength: number; // sma20/sma60 - 1
  ret20: number;
  ret60: number;
  vol20: number; // std of daily returns
  atr14: number; // absolute price units
  dd90: number; // min drawdown over last 90 trading days
  liquidity20: number; // avg volume
  volumeRatio: number; // last volume / avg20
  sector: string;
};

type EventSummary = {
  count: number;
  avgTone: number;
  topCategories: Array<{ category: string; count: number }>;
};

type StrategyId = "trend_sma" | "meanrev_rsi";

type Timeframe = "1h" | "3h" | "12h" | "1d" | "1w";

type BacktestResult = {
  curve: Array<{ t: string; equity: number }>;
  daily: number[];
  trades: number;
  wins: number;
  losses: number;
  stats: {
    totalReturn: number;
    cagr: number;
    sharpe: number;
    maxDrawdown: number;
    costBps: number;
  };
};

const FACETS: Array<{ id: FacetId; zh: string; en: string }> = [
  { id: "technical", zh: "技術面", en: "Technical" },
  { id: "sentiment", zh: "情緒/敘事", en: "Sentiment" },
  { id: "macro", zh: "宏觀/政策", en: "Macro" },
  { id: "fundamental", zh: "基本面", en: "Fundamentals" },
  { id: "flows", zh: "資金流/衍生品", en: "Flows" },
  { id: "exogenous", zh: "外生事件", en: "Exogenous" },
];

const TW_NEWS_DOMAINS = [
  "cna.com.tw",
  "udn.com",
  "money.udn.com",
  "ltn.com.tw",
  "ctee.com.tw",
  "anue.com",
  "chinatimes.com",
  "cmoney.tw",
  "storm.mg",
  "businessweekly.com.tw",
  "thenewslens.com",
];

const SECTOR_TAGS: { [k: string]: string } = {
  "2330.TW": "semiconductor",
  "2454.TW": "semiconductor",
  "2303.TW": "semiconductor",
  "3711.TW": "semiconductor",
  "NVDA": "semiconductor",
  "AVGO": "semiconductor",
  "AMD": "semiconductor",
  "INTC": "semiconductor",
  "TSM": "semiconductor",

  "AAPL": "consumer_tech",
  "MSFT": "software",
  "GOOGL": "internet",
  "META": "internet",
  "AMZN": "consumer_internet",
  "TSLA": "auto_ev",

  "2317.TW": "electronics_manufacturing",
  "2382.TW": "electronics_manufacturing",
  "3231.TW": "electronics_manufacturing",
  "2357.TW": "hardware",

  "2881.TW": "bank",
  "2882.TW": "bank",
  "2891.TW": "bank",

  "2603.TW": "shipping",

  "SPY": "index_etf",
  "QQQ": "index_etf",
  "0050.TW": "index_etf",
  "0056.TW": "dividend_etf",
  "00878.TW": "dividend_etf",

  "TLT": "bond_etf",
  "GLD": "commodity_etf",
};

const STOCKS: StockOption[] = [
  { value: "2330.TW", label: "2330.TW - 台積電", defaultQuery: "台積電" },
  { value: "2317.TW", label: "2317.TW - 鴻海", defaultQuery: "鴻海 OR Foxconn" },
  { value: "2454.TW", label: "2454.TW - 聯發科", defaultQuery: "聯發科 OR MediaTek" },
  { value: "2303.TW", label: "2303.TW - 聯電", defaultQuery: "聯電 OR UMC" },
  { value: "3711.TW", label: "3711.TW - 日月光投控", defaultQuery: "日月光 OR ASE" },
  { value: "2603.TW", label: "2603.TW - 長榮", defaultQuery: "長榮 OR Evergreen" },
  { value: "2881.TW", label: "2881.TW - 富邦金", defaultQuery: "富邦金" },
  { value: "2882.TW", label: "2882.TW - 國泰金", defaultQuery: "國泰金" },
  { value: "2891.TW", label: "2891.TW - 中信金", defaultQuery: "中信金" },
  { value: "0050.TW", label: "0050.TW - 元大台灣50", defaultQuery: "0050" },
  { value: "0056.TW", label: "0056.TW - 元大高股息", defaultQuery: "0056" },
  { value: "00878.TW", label: "00878.TW - 國泰永續高股息", defaultQuery: "00878" },

  { value: "AAPL", label: "AAPL - Apple", defaultQuery: "Apple OR AAPL", stooqSymbol: "AAPL.US" },
  { value: "MSFT", label: "MSFT - Microsoft", defaultQuery: "Microsoft OR MSFT", stooqSymbol: "MSFT.US" },
  { value: "NVDA", label: "NVDA - NVIDIA", defaultQuery: "NVIDIA OR NVDA", stooqSymbol: "NVDA.US" },
  { value: "AMZN", label: "AMZN - Amazon", defaultQuery: "Amazon OR AMZN", stooqSymbol: "AMZN.US" },
  { value: "GOOGL", label: "GOOGL - Alphabet", defaultQuery: "Alphabet OR Google OR GOOGL", stooqSymbol: "GOOGL.US" },
  { value: "META", label: "META - Meta", defaultQuery: "Meta OR Facebook OR META", stooqSymbol: "META.US" },
  { value: "TSLA", label: "TSLA - Tesla", defaultQuery: "Tesla OR TSLA", stooqSymbol: "TSLA.US" },
  { value: "TSM", label: "TSM - TSMC ADR", defaultQuery: "TSMC OR Taiwan Semiconductor OR TSM", stooqSymbol: "TSM.US" },
  { value: "SPY", label: "SPY - S&P 500 ETF", defaultQuery: "S&P 500 OR SPY", stooqSymbol: "SPY.US" },
  { value: "QQQ", label: "QQQ - Nasdaq 100 ETF", defaultQuery: "Nasdaq 100 OR QQQ", stooqSymbol: "QQQ.US" },
  { value: "TLT", label: "TLT - 20+Y Treasury ETF", defaultQuery: "Treasury OR TLT", stooqSymbol: "TLT.US" },
  { value: "GLD", label: "GLD - Gold ETF", defaultQuery: "Gold OR GLD", stooqSymbol: "GLD.US" },
];

function clamp(x: number, a: number, b: number) {
  return Math.max(a, Math.min(b, x));
}

function fmtNum(x: number, d: number) {
  if (!Number.isFinite(x)) return "-";
  return x.toFixed(d);
}

function fmtPct(x: number) {
  if (!Number.isFinite(x)) return "-";
  const v = x * 100;
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function mean(xs: number[]) {
  const ys = xs.filter((x) => Number.isFinite(x));
  if (!ys.length) return NaN;
  return ys.reduce((a, b) => a + b, 0) / ys.length;
}

function std(xs: number[]) {
  const ys = xs.filter((x) => Number.isFinite(x));
  if (ys.length < 2) return NaN;
  const m = mean(ys);
  const v = ys.reduce((a, b) => a + (b - m) * (b - m), 0) / (ys.length - 1);
  return Math.sqrt(v);
}

function dateISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return String(y) + "-" + m + "-" + dd;
}

function addDaysISO(iso: string, days: number) {
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() + days);
  return dateISO(d);
}

function toGdeltDatetime(yyyy_mm_dd: string, hhmmss: string) {
  const parts = yyyy_mm_dd.split("-");
  if (parts.length !== 3) return "";
  return parts[0] + parts[1] + parts[2] + hhmmss;
}

function normalizeHttpUrl(u: string) {
  const s = (u || "").trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.indexOf("http://") === 0 || lower.indexOf("https://") === 0) return s;
  return "https://" + s;
}

function filterByDate(rows: OHLCV[], from: string, to: string) {
  if (!from || !to) return rows;
  return rows.filter((r) => r.t >= from && r.t <= to);
}

function isoWeekId(iso: string) {
  // ISO week key like 2026-W08
  const p = iso.split("-");
  if (p.length !== 3) return "";
  const y = Number(p[0]);
  const m = Number(p[1]);
  const d = Number(p[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return "";

  const dt = new Date(y, m - 1, d);
  dt.setHours(0, 0, 0, 0);

  // Thursday in current week decides the year.
  const day = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
  dt.setDate(dt.getDate() - day + 3);

  const firstThu = new Date(dt.getFullYear(), 0, 4);
  firstThu.setHours(0, 0, 0, 0);
  const firstDay = (firstThu.getDay() + 6) % 7;
  firstThu.setDate(firstThu.getDate() - firstDay + 3);

  const week = 1 + Math.round((dt.getTime() - firstThu.getTime()) / (7 * 24 * 3600 * 1000));
  const wk = String(week).padStart(2, "0");
  return String(dt.getFullYear()) + "-W" + wk;
}

function resampleToWeek(rows: OHLCV[]) {
  if (!rows.length) return [] as OHLCV[];

  const out: OHLCV[] = [];
  let curKey = "";
  let cur: OHLCV | null = null;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const k = isoWeekId(r.t);
    if (!k) continue;

    if (!cur || k !== curKey) {
      if (cur) out.push(cur);
      curKey = k;
      cur = {
        t: r.t,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
      };
    } else {
      cur.t = r.t; // use last date in the week as label
      cur.high = Math.max(cur.high, r.high);
      cur.low = Math.min(cur.low, r.low);
      cur.close = r.close;
      cur.volume = cur.volume + r.volume;
    }
  }

  if (cur) out.push(cur);
  return out;
}

function stripCommas(s: string) {
  return (s || "").split(",").join("");
}

function rocToIso(roc: string) {
  const parts = (roc || "").split("/");
  if (parts.length !== 3) return "";
  const yy = Number(parts[0]);
  const mm = Number(parts[1]);
  const dd = Number(parts[2]);
  if (!Number.isFinite(yy) || !Number.isFinite(mm) || !Number.isFinite(dd)) return "";
  const y = yy + 1911;
  return String(y) + "-" + String(mm).padStart(2, "0") + "-" + String(dd).padStart(2, "0");
}

function sma(values: number[], win: number) {
  const out: Array<number | null> = Array(values.length).fill(null);
  let s = 0;
  const q: number[] = [];
  for (let i = 0; i < values.length; i++) {
    q.push(values[i]);
    s += values[i];
    if (q.length > win) s -= q.shift() as number;
    if (q.length === win) out[i] = s / win;
  }
  return out;
}

function rsi(closes: number[], period: number) {
  const out: Array<number | null> = Array(closes.length).fill(null);
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < closes.length; i++) {
    const chg = closes[i] - closes[i - 1];
    const g = Math.max(0, chg);
    const l = Math.max(0, -chg);

    if (i <= period) {
      gains += g;
      losses += l;
      if (i === period) {
        const rs = losses === 0 ? Infinity : gains / losses;
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gains = (gains * (period - 1) + g) / period;
      losses = (losses * (period - 1) + l) / period;
      const rs = losses === 0 ? Infinity : gains / losses;
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
}

function parseStooqCSV(csv: string): OHLCV[] {
  const raw = (csv || "").trim();
  if (!raw) return [];

  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);

  const normalized = raw.split(CR).join("");
  const lines = normalized
    .split(LF)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) return [];

  const out: OHLCV[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(",");
    if (parts.length < 6) continue;

    const t = (parts[0] || "").trim();
    if (!t) continue;

    const row: OHLCV = {
      t: t,
      open: Number(parts[1]),
      high: Number(parts[2]),
      low: Number(parts[3]),
      close: Number(parts[4]),
      volume: Number(parts[5]),
    };

    if (Number.isFinite(row.close)) out.push(row);
  }

  return out;
}

type TwseStockDayJson = {
  stat?: string;
  data?: string[][];
};

function parseTwseStockDayJson(j: TwseStockDayJson): OHLCV[] {
  const rows = Array.isArray(j && j.data) ? (j.data as string[][]) : [];
  if (!rows.length) return [];

  const out: OHLCV[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 7) continue;

    const iso = rocToIso(String(r[0] || ""));
    if (!iso) continue;

    const volShares = Number(stripCommas(String(r[1] || "0")));
    const open = Number(stripCommas(String(r[3] || "")));
    const high = Number(stripCommas(String(r[4] || "")));
    const low = Number(stripCommas(String(r[5] || "")));
    const close = Number(stripCommas(String(r[6] || "")));

    if (!Number.isFinite(close)) continue;

    out.push({
      t: iso,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close: close,
      volume: Number.isFinite(volShares) ? volShares : 0,
    });
  }

  out.sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  return out;
}

function iterMonths(fromIso: string, toIso: string) {
  const a = fromIso.split("-");
  const b = toIso.split("-");
  if (a.length !== 3 || b.length !== 3) return [] as { y: number; m: number }[];

  let y = Number(a[0]);
  let m = Number(a[1]);
  const y2 = Number(b[0]);
  const m2 = Number(b[1]);

  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(y2) || !Number.isFinite(m2)) return [];

  const out: { y: number; m: number }[] = [];
  while (y < y2 || (y === y2 && m <= m2)) {
    out.push({ y: y, m: m });
    m += 1;
    if (m === 13) {
      m = 1;
      y += 1;
    }
    if (out.length > 240) break;
  }
  return out;
}

function guessProvider(sym: string): Provider {
  const u = (sym || "").toUpperCase();
  if (u.indexOf(".TW") > 0) return "twse";
  return "stooq";
}

function lastN<T>(xs: T[], n: number) {
  if (n <= 0) return [] as T[];
  const start = Math.max(0, xs.length - n);
  return xs.slice(start);
}

function computeATRSeries(rows: OHLCV[], period: number) {
  const out: Array<number | null> = Array(rows.length).fill(null);
  if (rows.length < 2) return out;

  const trs: number[] = [];
  trs.push(NaN);
  for (let i = 1; i < rows.length; i++) {
    const prevClose = rows[i - 1].close;
    const hi = rows[i].high;
    const lo = rows[i].low;
    const tr1 = hi - lo;
    const tr2 = Math.abs(hi - prevClose);
    const tr3 = Math.abs(lo - prevClose);
    const tr = Math.max(tr1, Math.max(tr2, tr3));
    trs.push(tr);
  }

  let s = 0;
  const q: number[] = [];
  for (let i = 0; i < trs.length; i++) {
    const v = trs[i];
    if (!Number.isFinite(v)) {
      q.push(v);
    } else {
      q.push(v);
      s += v;
    }

    if (q.length > period) {
      const popped = q.shift() as number;
      if (Number.isFinite(popped)) s -= popped;
    }

    if (q.length === period) {
      const denom = q.filter((x) => Number.isFinite(x)).length;
      out[i] = denom > 0 ? s / denom : null;
    }
  }

  return out;
}

function computeMaxDrawdownFromCurve(curve: Array<{ equity: number }>) {
  let peak = -Infinity;
  let mdd = 0;
  for (let i = 0; i < curve.length; i++) {
    const e = curve[i].equity;
    if (e > peak) peak = e;
    const dd = peak > 0 ? (e - peak) / peak : 0;
    if (dd < mdd) mdd = dd;
  }
  return mdd;
}

function computeAssetProfile(rows: OHLCV[], symbol: string): AssetProfile | null {
  if (!rows.length) return null;

  const closes = rows.map((r) => r.close);
  const vols = rows.map((r) => r.volume);

  const last = rows[rows.length - 1];

  const sma20 = sma(closes, 20);
  const sma60 = sma(closes, 60);
  const sma20Last = (sma20.length ? sma20[sma20.length - 1] : null) as number | null;
  const sma60Last = (sma60.length ? sma60[sma60.length - 1] : null) as number | null;

  const trendStrength = sma20Last != null && sma60Last != null && sma60Last !== 0 ? sma20Last / sma60Last - 1 : NaN;

  let trend: "up" | "down" | "side" = "side";
  if (sma60Last != null && Number.isFinite(trendStrength)) {
    if (last.close > sma60Last && trendStrength > 0.005) trend = "up";
    else if (last.close < sma60Last && trendStrength < -0.005) trend = "down";
    else trend = "side";
  }

  const rets: number[] = [];
  for (let i = 1; i < rows.length; i++) rets.push(rows[i].close / rows[i - 1].close - 1);
  const vol20 = std(lastN(rets, 20));

  const ret20 = rows.length > 20 ? last.close / rows[rows.length - 21].close - 1 : NaN;
  const ret60 = rows.length > 60 ? last.close / rows[rows.length - 61].close - 1 : NaN;

  const atrS = computeATRSeries(rows, 14);
  const atr14 = atrS.length ? (atrS[atrS.length - 1] as number | null) : null;

  // dd90
  const seg = lastN(rows, 90);
  let peak = -Infinity;
  let dd90 = 0;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i].close;
    if (c > peak) peak = c;
    const dd = peak > 0 ? (c - peak) / peak : 0;
    if (dd < dd90) dd90 = dd;
  }

  const liquidity20 = mean(lastN(vols, 20));
  const volumeRatio = Number.isFinite(liquidity20) && liquidity20 > 0 ? last.volume / liquidity20 : NaN;

  const u = (symbol || "").trim().toUpperCase();
  const sector = SECTOR_TAGS[u] || "unknown";

  return {
    trend: trend,
    trendStrength: trendStrength,
    ret20: ret20,
    ret60: ret60,
    vol20: vol20,
    atr14: atr14 != null ? atr14 : NaN,
    dd90: dd90,
    liquidity20: liquidity20,
    volumeRatio: volumeRatio,
    sector: sector,
  };
}

function classifyEventTitle(title: string) {
  const t = (title || "").toLowerCase();

  function hasAny(keys: string[]) {
    for (let i = 0; i < keys.length; i++) {
      if (t.indexOf(keys[i]) >= 0) return true;
    }
    return false;
  }

  const catE = hasAny(["earnings", "guidance", "forecast", "outlook", "財報", "法說", "財測", "展望", "營收", "毛利", "eps"]);
  const catC = hasAny(["capex", "capacity", "fab", "expansion", "擴產", "投資", "產能", "新廠", "晶圓廠"]);
  const catG = hasAny(["export", "control", "sanction", "tariff", "restriction", "geopolit", "war", "taiwan", "china", "美國", "制裁", "禁令", "出口管制", "地緣", "軍事", "戰爭"]);
  const catO = hasAny(["earthquake", "fire", "outage", "shutdown", "accident", "停電", "地震", "火災", "事故", "停工"]);
  const catR = hasAny(["dividend", "buyback", "split", "配息", "股利", "庫藏股", "減資", "增資"]);
  const catM = hasAny(["rate", "inflation", "fed", "cpi", "pmi", "recession", "利率", "通膨", "聯準會", "景氣", "衰退"]);

  let category = "General";
  if (catE) category = "Earnings/Guidance";
  else if (catC) category = "Capex/Capacity";
  else if (catG) category = "Geopolitics/Regulation";
  else if (catO) category = "Operational Disruption";
  else if (catR) category = "Capital Return";
  else if (catM) category = "Macro";

  return { category: category };
}

function computeEventSummary(evRows: NewsEvent[]): EventSummary {
  const rows = Array.isArray(evRows) ? evRows : [];
  const tones: number[] = [];
  const catCount: { [k: string]: number } = {};

  for (let i = 0; i < rows.length; i++) {
    const t = rows[i].tone;
    if (typeof t === "number" && Number.isFinite(t)) tones.push(t);

    const c = classifyEventTitle(rows[i].title).category;
    catCount[c] = (catCount[c] || 0) + 1;
  }

  const top: Array<{ category: string; count: number }> = Object.keys(catCount)
    .map((k) => ({ category: k, count: catCount[k] }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return {
    count: rows.length,
    avgTone: tones.length ? mean(tones) : NaN,
    topCategories: top,
  };
}

function parseEventDateToIso(seendate?: string) {
  const s0 = (seendate || "").trim();
  if (!s0) return "";

  if (s0.indexOf("-") >= 0 && s0.length >= 10) return s0.slice(0, 10);

  let digits = "";
  for (let i = 0; i < s0.length; i++) {
    const c = s0.charCodeAt(i);
    if (c >= 48 && c <= 57) digits += s0[i];
  }
  if (digits.length < 8) return "";

  const y = digits.slice(0, 4);
  const m = digits.slice(4, 6);
  const d = digits.slice(6, 8);
  return y + "-" + m + "-" + d;
}

function buildEventCountByDate(events: NewsEvent[]) {
  const map: { [iso: string]: number } = {};
  for (let i = 0; i < events.length; i++) {
    const iso = parseEventDateToIso(events[i].seendate);
    if (!iso) continue;
    map[iso] = (map[iso] || 0) + 1;
  }
  return map;
}

function clampGdeltRange(fromIso: string, toIso: string, todayIso: string) {
  let to = (toIso || "").trim();
  let from = (fromIso || "").trim();
  const today = (todayIso || "").trim();

  if (today && to && to > today) to = today;

  const minFrom = today ? addDaysISO(today, -90) : from;
  if (minFrom && from && from < minFrom) from = minFrom;

  if (from && to && from > to) {
    from = addDaysISO(to, -7);
    if (from > to) from = to;
  }

  return { from, to, minFrom };
}

async function fetchJsonLoose(url: string) {
  const resp = await fetch(url);
  const text = await resp.text();

  const CR = String.fromCharCode(13);
  const LF = String.fromCharCode(10);

  const snippet = (text || "")
    .slice(0, 180)
    .split(LF)
    .join(" ")
    .split(CR)
    .join(" ");

  if (!resp.ok) throw new Error("HTTP " + String(resp.status) + ": " + snippet);

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Non-JSON response: " + snippet);
  }
}

function looksAdvancedQuery(q: string) {
  const s = (q || "").trim();
  if (!s) return false;
  if (s.indexOf(" OR ") >= 0) return true;
  if (s.indexOf("(") >= 0 || s.indexOf(")") >= 0) return true;
  if (s.indexOf("\"") >= 0) return true;
  return false;
}

function getEventSynonyms(symbol: string, rawQuery: string) {
  const q = (rawQuery || "").trim();
  const up = (symbol || "").trim().toUpperCase();

  const advanced = looksAdvancedQuery(q);
  const list: string[] = [];

  if (q && !advanced) list.push(q);

  if (up === "2330.TW") {
    const extra = ["台積電", "Taiwan Semiconductor", "Taiwan Semiconductor Manufacturing", "TSMC", "2330"];
    for (let i = 0; i < extra.length; i++) if (list.indexOf(extra[i]) < 0) list.push(extra[i]);
  } else if (up === "TSM") {
    const extra = ["Taiwan Semiconductor", "Taiwan Semiconductor Manufacturing", "TSMC", "台積電"];
    for (let i = 0; i < extra.length; i++) if (list.indexOf(extra[i]) < 0) list.push(extra[i]);
  } else {
    if (!advanced && up && list.indexOf(up) < 0) list.push(up);
  }

  return { advanced: advanced, raw: q, terms: list.filter((s) => (s || "").trim().length > 0) };
}

function gdeltTermLen(s: string) {
  const t = (s || "").trim();
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    const isDigit = c >= 48 && c <= 57;
    const isUpper = c >= 65 && c <= 90;
    const isLower = c >= 97 && c <= 122;
    const isCJK = c >= 0x4e00 && c <= 0x9fff;
    if (isDigit || isUpper || isLower || isCJK) n += 1;
  }
  return n;
}

function buildGdeltOrTerms(terms: string[], strictQuotes: boolean, aggressiveDrop: boolean) {
  const kept: string[] = [];

  for (let i = 0; i < terms.length; i++) {
    const raw = (terms[i] || "").trim();
    if (!raw) continue;

    const hasSpace = raw.indexOf(" ") >= 0;
    const len = gdeltTermLen(raw);

    if (aggressiveDrop) {
      if (!hasSpace && len < 5) continue;
    } else {
      if (!hasSpace && len < 2) continue;
    }

    if (strictQuotes) {
      if (hasSpace || len >= 5) kept.push("\"" + raw + "\"");
      else kept.push(raw);
    } else {
      kept.push(raw);
    }
  }

  if (!kept.length) {
    for (let i = 0; i < terms.length; i++) {
      const raw = (terms[i] || "").trim();
      if (raw) kept.push(raw);
    }
  }

  return kept;
}

function scoreArticle(a: NewsEvent, terms: string[], preferTW: boolean) {
  const title = (a.title || "").toLowerCase();
  const url = (a.url || "").toLowerCase();
  const domain = (a.domain || "").toLowerCase();

  let s = 0;
  for (let i = 0; i < terms.length; i++) {
    const t = (terms[i] || "").toLowerCase();
    if (!t) continue;
    if (title.indexOf(t) >= 0) s += 4;
    else if (url.indexOf(t) >= 0) s += 1;
  }

  if (preferTW && domain) {
    for (let i = 0; i < TW_NEWS_DOMAINS.length; i++) {
      const d = TW_NEWS_DOMAINS[i];
      if (domain === d || domain.indexOf("." + d) > 0 || domain.indexOf(d) >= 0) {
        s += 2;
        break;
      }
    }
  }

  if (title.indexOf("tsmc") >= 0) s += 1;
  if (title.indexOf("台積電") >= 0) s += 2;

  return s;
}

function passLangCountry(a: NewsEvent, lang: EventLang, country: EventCountry) {
  const l = (a.language || "").toLowerCase();
  const c = (a.sourceCountry || "").toLowerCase();

  if (lang === "chinese") {
    if (l && l.indexOf("ch") < 0 && l.indexOf("chi") < 0 && l.indexOf("chinese") < 0) return false;
  }
  if (lang === "english") {
    if (l && l.indexOf("en") < 0 && l.indexOf("eng") < 0 && l.indexOf("english") < 0) return false;
  }

  if (country === "twn") {
    if (c && c.indexOf("twn") < 0 && c.indexOf("tai") < 0 && c.indexOf("taiwan") < 0) return false;
  }
  if (country === "usa") {
    if (c && c.indexOf("usa") < 0 && c.indexOf("united") < 0 && c.indexOf("us") !== 0) return false;
  }
  if (country === "chn") {
    if (c && c.indexOf("chn") < 0 && c.indexOf("china") < 0) return false;
  }

  return true;
}

function buildFacetSuggestions(args: { symbol: string; profile: AssetProfile | null; eventSummary: EventSummary; facets: FacetId[] }) {
  const out: Array<{ title: string; items: string[] }> = [];

  const p = args.profile;
  const es = args.eventSummary;

  function has(id: FacetId) {
    return args.facets.indexOf(id) >= 0;
  }

  const stateLine = (() => {
    if (!p) return "尚未載入足夠股價資料，Facet 建議會偏抽象。";

    const t = p.trend === "up" ? "上行" : p.trend === "down" ? "下行" : "盤整";
    const s = Number.isFinite(p.trendStrength) ? (p.trendStrength * 100).toFixed(2) + "%" : "-";
    const v = Number.isFinite(p.vol20) ? (p.vol20 * 100).toFixed(2) + "%" : "-";
    const dd = Number.isFinite(p.dd90) ? (p.dd90 * 100).toFixed(2) + "%" : "-";
    const vr = Number.isFinite(p.volumeRatio) ? p.volumeRatio.toFixed(2) + "x" : "-";

    return "画像：" + args.symbol + " | 型態=" + t + " | trend=" + s + " | vol20=" + v + " | dd90=" + dd + " | volRatio=" + vr + " | sector=" + (p.sector || "-");
  })();

  if (has("technical")) {
    const items: string[] = [];
    items.push(stateLine);

    if (p) {
      if (p.trend === "up") {
        items.push("趨勢延續假設：用趨勢模板回測（SMA20/SMA60），並用 ATR stop 降低被震出。 ");
      } else if (p.trend === "down") {
        items.push("下行期：先測『反轉後進場』，避免抄底；可以用 RSI>50 + 站回 SMA60 當條件。 ");
      } else {
        items.push("盤整期：均值回歸模板比較可能有 edge（RSI 進出場），但成本敏感。 ");
      }
    }

    out.push({ title: "技術面（Technical）", items: items });
  }

  if (has("sentiment")) {
    const items: string[] = [];
    items.push("事件量=" + String(es.count) + "；平均 tone=" + (Number.isFinite(es.avgTone) ? es.avgTone.toFixed(2) : "-") + "。 ");
    if (es.topCategories.length) items.push("Top categories：" + es.topCategories.map((x) => x.category + "(" + String(x.count) + ")").join(", ") + "。 ");
    items.push("可回測問題：事件日（或事件量暴增日）是否提升波動？可把事件日當 gating（縮倉/不進場）測試。 ");
    out.push({ title: "情緒/敘事（Sentiment）", items: items });
  }

  if (has("macro")) {
    const items: string[] = [];
    items.push(stateLine);
    if (p && p.sector === "semiconductor") items.push("半導體：地緣/出口管制會改變 risk premium；可把相關事件類別做 event study。 ");
    else if (p && (p.sector === "index_etf" || p.sector === "dividend_etf")) items.push("ETF：更偏系統性；宏觀事件（CPI/Fed）通常比公司新聞重要。 ");
    else if (p && p.sector === "bank") items.push("金融：利率/殖利率曲線是大變因；策略要做 regime split。 ");
    else items.push("宏觀：先判定主要驅動是系統性還是公司特定，否則你會把噪聲當訊號。 ");
    out.push({ title: "宏觀/政策（Macro）", items: items });
  }

  if (has("fundamental")) {
    const items: string[] = [];
    if (p && p.sector === "semiconductor") items.push("半導體：Capex/產能與毛利率假設是核心；事件分類可協助你挑出『指引/擴產』窗口做研究。 ");
    else items.push("基本面：若尚未接財務資料源，先用『事件分類 + 價量反應』做可驗證假設，再決定要不要拉財務資料。 ");
    out.push({ title: "基本面（Fundamentals）", items: items });
  }

  if (has("flows")) {
    const items: string[] = [];
    items.push(stateLine);
    items.push("可回測：volume gate（量能門檻）→ 只在 volRatio>門檻時進場，看是否提升 Sharpe/降低 DD。 ");
    out.push({ title: "資金流/衍生品（Flows）", items: items });
  }

  if (has("exogenous")) {
    const items: string[] = [];
    items.push("外生事件：不要預測，靠曝險縮放與停損處理尾端。可回測事件日縮倉。 ");
    out.push({ title: "外生事件（Exogenous）", items: items });
  }

  return out;
}

function buildInvestmentGuidance(args: {
  symbol: string;
  style: InvestStyle;
  risk: RiskLevel;
  horizonYears: number;
  maxSinglePct: number;
  profile: AssetProfile | null;
  eventSummary: EventSummary;
}) {
  const out: Array<{ title: string; items: string[] }> = [];

  const styleName = args.style === "long" ? "長期" : args.style === "swing" ? "波段" : "短線";
  const riskName = args.risk === "low" ? "保守" : args.risk === "mid" ? "中性" : "積極";

  const p = args.profile;
  const es = args.eventSummary;

  const regime = (() => {
    if (!p) return "n/a";
    const t = p.trend === "up" ? "trend-up" : p.trend === "down" ? "trend-down" : "sideways";
    const v = Number.isFinite(p.vol20) ? (p.vol20 > 0.02 ? "high-vol" : p.vol20 < 0.012 ? "low-vol" : "mid-vol") : "vol-n/a";
    const d = Number.isFinite(p.dd90) ? (p.dd90 < -0.15 ? "deep-dd" : p.dd90 < -0.08 ? "mid-dd" : "shallow-dd") : "dd-n/a";
    return t + ", " + v + ", " + d;
  })();

  out.push({
    title: "共同原則（Common）",
    items: [
      "教育用途：以下為一般性框架，不構成投資建議。",
      "你目前設定：風格=" + styleName + "、風險=" + riskName + "、期限=" + String(args.horizonYears) + " 年、單一標的上限=" + String(args.maxSinglePct) + "% 。",
      "当下画像（Regime）=" + regime + "（由本頁股價推估）。",
      "最重要的不是『猜』，是把決策寫成規則並回測。",
    ],
  });

  // Risk / sizing (actionable)
  {
    const items: string[] = [];

    const baseRiskPerTrade = args.risk === "low" ? 0.0025 : args.risk === "mid" ? 0.005 : 0.01;
    items.push("把『每筆最大可承受虧損』寫成數字（Risk budget）。示例：單筆風險≈" + (baseRiskPerTrade * 100).toFixed(2) + "% 資金。 ");

    if (p && Number.isFinite(p.atr14) && p.atr14 > 0) {
      items.push("停損距離用 ATR（比固定 % 更一致）：stop≈k×ATR14（k 由策略決定）。");
      items.push("倉位估算（Position sizing）：positionValue≈accountValue×riskPerTrade÷(stopDistance/price)，再套用單一標的上限。");
    } else {
      items.push("若 ATR 無法穩定估計（資料不足），先用固定 % 停損做 baseline，再逐步改 ATR。 ");
    }

    if (es.count >= 30) items.push("事件密度偏高 → 事件日±1~3 天可視為高噪聲期：縮倉或提高停損距離，避免被洗。 ");

    out.push({ title: "風險與倉位（Risk / Sizing）", items: items });
  }

  // Templates (mapped to backtest)
  {
    const items: string[] = [];
    items.push("本頁已把兩個模板接進回測引擎：Trend(SMA) 與 MeanReversion(RSI)。");
    items.push("你可以調整成本、ATR stop、volume gate、事件日縮倉，直接看績效與回撤變化。 ");
    out.push({ title: "可回測模板（Templates）", items: items });
  }

  return out;
}

function parseEventDateToIsoForMap(s?: string) {
  return parseEventDateToIso(s);
}

function buildBacktestSignalTrend(rows: OHLCV[], fast: number, slow: number) {
  const closes = rows.map((r) => r.close);
  const f = sma(closes, fast);
  const s = sma(closes, slow);
  const sig: number[] = Array(rows.length).fill(0);
  for (let i = 0; i < rows.length; i++) {
    if (f[i] == null || s[i] == null) continue;
    const fi = f[i] as number;
    const si = s[i] as number;
    const cl = closes[i];
    sig[i] = fi > si && cl > si ? 1 : 0;
  }
  return { signal: sig, smaFast: f, smaSlow: s };
}

function buildBacktestSignalMeanRev(rows: OHLCV[], rsiPeriod: number, entry: number, exit: number) {
  const closes = rows.map((r) => r.close);
  const r = rsi(closes, rsiPeriod);
  const sig: number[] = Array(rows.length).fill(0);
  let pos = 0;
  for (let i = 0; i < rows.length; i++) {
    const ri = r[i];
    if (ri == null) {
      sig[i] = pos;
      continue;
    }
    const rv = ri as number;
    if (pos === 0 && rv < entry) pos = 1;
    else if (pos === 1 && rv > exit) pos = 0;
    sig[i] = pos;
  }
  return { signal: sig, rsiSeries: r };
}

function computeVolumeRatioSeries(rows: OHLCV[], win: number) {
  const out: Array<number | null> = Array(rows.length).fill(null);
  const q: number[] = [];
  let s = 0;
  for (let i = 0; i < rows.length; i++) {
    const v = rows[i].volume;
    q.push(v);
    s += v;
    if (q.length > win) s -= q.shift() as number;
    if (q.length === win) {
      const avg = s / win;
      out[i] = avg > 0 ? v / avg : null;
    }
  }
  return out;
}

function backtestFromSignal(args: {
  rows: OHLCV[];
  signal: number[];
  atr: Array<number | null>;
  volumeRatio: Array<number | null>;
  eventCountByDate: { [iso: string]: number };
  feeBps: number;
  slipBps: number;
  atrStopK: number;
  volumeGateOn: boolean;
  volumeGateThr: number;
  eventScaleOn: boolean;
  eventCountThr: number;
  eventScale: number;
}) {
  const rows = args.rows;
  const n = rows.length;
  if (n < 2) return null as any;

  const cost = clamp((args.feeBps + args.slipBps) / 10000, 0, 0.1);

  let equity = 1;
  let pos = 0;
  let entryPrice = NaN;
  let stopLevel = NaN;

  let trades = 0;
  let wins = 0;
  let losses = 0;

  const curve: Array<{ t: string; equity: number }> = [];
  const daily: number[] = [];

  function exposureForDay(dayIso: string) {
    if (!args.eventScaleOn) return 1;
    const c = args.eventCountByDate[dayIso] || 0;
    if (c >= args.eventCountThr) return clamp(args.eventScale, 0, 1);
    return 1;
  }

  // We use next-day close execution: signal[i-1] decides holding during day i (close[i-1] -> close[i]).
  for (let i = 1; i < n; i++) {
    const prevClose = rows[i - 1].close;
    const today = rows[i];

    // Desired position based on previous day's signal.
    const desired = args.signal[i - 1] ? 1 : 0;

    // Volume gate: apply only to new entries.
    let allowEntry = true;
    if (args.volumeGateOn && pos === 0 && desired === 1) {
      const vr = args.volumeRatio[i - 1];
      if (vr == null) allowEntry = false;
      else allowEntry = (vr as number) >= args.volumeGateThr;
    }

    // Position change at prev close (i-1).
    if (desired !== pos) {
      if (desired === 1 && !allowEntry) {
        // skip entry
      } else {
        // trade occurs
        equity *= 1 - cost;
        trades += 1;

        pos = desired;
        if (pos === 1) {
          entryPrice = prevClose;
          const a = args.atr[i - 1];
          if (a != null && Number.isFinite(a) && (a as number) > 0) stopLevel = entryPrice - args.atrStopK * (a as number);
          else stopLevel = NaN;
        } else {
          // exit
          if (Number.isFinite(entryPrice) && prevClose > 0) {
            const pnl = prevClose / entryPrice - 1;
            if (pnl >= 0) wins += 1;
            else losses += 1;
          }
          entryPrice = NaN;
          stopLevel = NaN;
        }
      }
    }

    const expo = pos === 1 ? exposureForDay(today.t) : 0;

    // Daily return
    let r = 0;
    if (pos === 1 && expo > 0) {
      // Stop-loss approximation using daily low
      if (Number.isFinite(stopLevel) && today.low <= stopLevel && prevClose > 0) {
        const rStop = stopLevel / prevClose - 1;
        r = expo * rStop;
        equity *= 1 + r;
        // exit cost
        equity *= 1 - cost;
        trades += 1;

        // win/loss
        if (Number.isFinite(entryPrice) && entryPrice > 0) {
          const pnl = stopLevel / entryPrice - 1;
          if (pnl >= 0) wins += 1;
          else losses += 1;
        }

        pos = 0;
        entryPrice = NaN;
        stopLevel = NaN;
      } else {
        const rr = prevClose > 0 ? today.close / prevClose - 1 : 0;
        r = expo * rr;
        equity *= 1 + r;
      }
    } else {
      // flat
      equity *= 1;
    }

    curve.push({ t: today.t, equity: equity });
    daily.push(r);
  }

  const totalReturn = equity - 1;
  const nn = daily.length || 1;
  const cagr = Math.pow(1 + totalReturn, 252 / nn) - 1;
  const sharpe = (mean(daily) / (std(daily) || NaN)) * Math.sqrt(252);
  const maxDrawdown = computeMaxDrawdownFromCurve(curve);

  const res: BacktestResult = {
    curve: curve,
    daily: daily,
    trades: trades,
    wins: wins,
    losses: losses,
    stats: {
      totalReturn: totalReturn,
      cagr: cagr,
      sharpe: sharpe,
      maxDrawdown: maxDrawdown,
      costBps: args.feeBps + args.slipBps,
    },
  };

  return res;
}

function Badge(props: { children: React.ReactNode; tone?: "neutral" | "good" | "bad" | "warn" }) {
  const tone = props.tone || "neutral";
  const cls =
    tone === "good"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : tone === "bad"
      ? "bg-rose-100 text-rose-800 border-rose-200"
      : tone === "warn"
      ? "bg-amber-100 text-amber-800 border-amber-200"
      : "bg-slate-100 text-slate-800 border-slate-200";
  return <span className={"inline-flex items-center rounded-full border px-2 py-0.5 text-xs " + cls}>{props.children}</span>;
}

function StatCard(props: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-sm text-slate-600">{props.title}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{props.value}</div>
      {props.sub ? <div className="mt-1 text-xs text-slate-500">{props.sub}</div> : null}
    </div>
  );
}


// ---------------------------------------------------------------------------
// Candlestick (K 線) panel: pure SVG (no external candlestick dependency)
// 台股慣例：紅=漲、綠=跌
// ---------------------------------------------------------------------------

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function update() {
      const r = el ? el.getBoundingClientRect() : null;
    if (!r) return;
      setSize({ w: Math.max(0, Math.floor(r.width)), h: Math.max(0, Math.floor(r.height)) });
    }

    update();

    let ro: any = null;
    if (typeof (window as any).ResizeObserver !== "undefined") {
      ro = new (window as any).ResizeObserver(() => update());
      ro.observe(el);
    } else {
      window.addEventListener("resize", update);
    }

    return () => {
      if (ro && ro.disconnect) ro.disconnect();
      else window.removeEventListener("resize", update);
    };
  }, []);

  return { ref, size };
}

function downsampleRows(rows: OHLCV[], maxPoints: number) {
  if (rows.length <= maxPoints) return { view: rows, idx: rows.map((_, i) => i) };
  const step = Math.ceil(rows.length / maxPoints);
  const view: OHLCV[] = [];
  const idx: number[] = [];
  for (let i = 0; i < rows.length; i += step) {
    view.push(rows[i]);
    idx.push(i);
  }
  if (idx[idx.length - 1] !== rows.length - 1) {
    view.push(rows[rows.length - 1]);
    idx.push(rows.length - 1);
  }
  return { view, idx };
}

function CandlestickPanel(props: { rows: OHLCV[]; smaFast: Array<number | null>; smaSlow: Array<number | null> }) {
  const { ref, size } = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);

  const packed = useMemo(() => {
    const ds = downsampleRows(props.rows, 260);
    const view = ds.view;
    const idx = ds.idx;

    const f: Array<number | null> = idx.map((k) => props.smaFast[k] ?? null);
    const s: Array<number | null> = idx.map((k) => props.smaSlow[k] ?? null);

    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < view.length; i++) {
      lo = Math.min(lo, view[i].low);
      hi = Math.max(hi, view[i].high);
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) {
      lo = 0;
      hi = 1;
    }

    return { view, f, s, lo, hi };
  }, [props.rows, props.smaFast, props.smaSlow]);

  const pad = 12;
  const w = size.w || 0;
  const h = size.h || 0;
  const plotW = Math.max(0, w - pad * 2);
  const plotH = Math.max(0, h - pad * 2);
  const n = packed.view.length;

  const xAt = (i: number) => {
    if (n <= 1) return pad;
    const t = i / (n - 1);
    return pad + t * plotW;
  };

  const yAt = (price: number) => {
    const lo = packed.lo;
    const hi = packed.hi;
    const t = hi === lo ? 0.5 : (price - lo) / (hi - lo);
    return pad + (1 - t) * plotH;
  };

  const candleW = (() => {
    if (n <= 1) return 6;
    const step = plotW / (n - 1);
    return clamp(step * 0.6, 2, 12);
  })();

  const polyline = (series: Array<number | null>) => {
    const pts: string[] = [];
    for (let i = 0; i < n; i++) {
      const v = series[i];
      if (v == null || !Number.isFinite(v as number)) continue;
      pts.push(String(xAt(i)) + "," + String(yAt(v as number)));
    }
    return pts.join(" ");
  };

  const onMove = (evt: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el ? el.getBoundingClientRect() : null;
    if (!r) return;
    const mx = evt.clientX - r.left;
    const my = evt.clientY - r.top;
    if (mx < pad || mx > w - pad || my < pad || my > h - pad) {
      setHover(null);
      return;
    }

    if (n <= 1) {
      setHover({ i: 0, x: mx, y: my });
      return;
    }

    const t = (mx - pad) / (plotW || 1);
    const i = clamp(Math.round(t * (n - 1)), 0, n - 1);
    setHover({ i: i, x: mx, y: my });
  };

  const onLeave = () => setHover(null);

  const tooltip = (() => {
    if (!hover) return null;
    const i = hover.i;
    const r = packed.view[i];
    if (!r) return null;

    const boxW = 210;
    const boxH = 120;
    const left = clamp(hover.x + 12, 8, Math.max(8, w - boxW - 8));
    const top = clamp(hover.y + 12, 8, Math.max(8, h - boxH - 8));

    const up = r.close >= r.open;
    const color = up ? "text-rose-700" : "text-emerald-700";

    return (
      <div className="pointer-events-none absolute rounded-xl border bg-white p-3 text-xs shadow" style={{ left: left, top: top, width: boxW }}>
        <div className="font-semibold text-slate-900">{r.t}</div>
        <div className={"mt-1 font-semibold " + color}>{up ? "紅K（收 ≥ 開）" : "綠K（收 < 開）"}</div>
        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-slate-700">
          <div>開：{fmtNum(r.open, 2)}</div>
          <div>收：{fmtNum(r.close, 2)}</div>
          <div>高：{fmtNum(r.high, 2)}</div>
          <div>低：{fmtNum(r.low, 2)}</div>
          <div className="col-span-2 text-slate-500">量：{Number.isFinite(r.volume) ? String(Math.round(r.volume)) : "-"}</div>
        </div>
      </div>
    );
  })();

  return (
    <div className="relative h-full w-full" ref={ref} onMouseMove={onMove} onMouseLeave={onLeave}>
      <svg width={w} height={h} className="block">
        <rect x={0} y={0} width={w} height={h} fill="white" />

        {(() => {
          const lines = 4;
          const elems: React.ReactNode[] = [];
          for (let k = 0; k <= lines; k++) {
            const yy = pad + (plotH * k) / lines;
            elems.push(<line key={k} x1={pad} y1={yy} x2={w - pad} y2={yy} stroke="#e2e8f0" strokeDasharray="3 3" />);
          }
          return elems;
        })()}

        {packed.view.map((r, i) => {
          const x = xAt(i);
          const yH = yAt(r.high);
          const yL = yAt(r.low);
          const yO = yAt(r.open);
          const yC = yAt(r.close);

          const up = r.close >= r.open;
          const bodyTop = Math.min(yO, yC);
          const bodyBot = Math.max(yO, yC);
          const bodyH = Math.max(1, bodyBot - bodyTop);

          const stroke = up ? "#be123c" : "#059669";
          const fill = up ? "#fecdd3" : "#bbf7d0";

          return (
            <g key={i}>
              <line x1={x} y1={yH} x2={x} y2={yL} stroke={stroke} strokeWidth={1} />
              <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={fill} stroke={stroke} strokeWidth={1} />
            </g>
          );
        })}

        <polyline fill="none" stroke="#0f172a" strokeWidth={1.5} points={polyline(packed.f)} />
        <polyline fill="none" stroke="#334155" strokeWidth={1.2} points={polyline(packed.s)} />

        {hover ? <line x1={xAt(hover.i)} y1={pad} x2={xAt(hover.i)} y2={h - pad} stroke="#64748b" strokeDasharray="4 4" /> : null}

        <text x={pad} y={pad - 2} fontSize={11} fill="#475569">
          高：{fmtNum(packed.hi, 2)}
        </text>
        <text x={pad} y={h - 4} fontSize={11} fill="#475569">
          低：{fmtNum(packed.lo, 2)}
        </text>
      </svg>

      {tooltip}

      <div className="absolute bottom-2 right-2 rounded-lg border bg-white px-2 py-1 text-[11px] text-slate-600 shadow-sm">
        K 線：紅=漲、綠=跌｜線：SMA fast/slow
      </div>
    </div>
  );
}

function runSelfTestsOnce() {
  console.assert(rocToIso("115/02/11") === "2026-02-11", "rocToIso mapping");

  const fixture: TwseStockDayJson = {
    stat: "OK",
    data: [["115/02/11", "44,684,131", "85,272,506,875", "1,880.00", "1,925.00", "1,875.00", "1,915.00", "+35.00", "150,409"]],
  };

  const tw = parseTwseStockDayJson(fixture);
  console.assert(tw.length === 1 && tw[0].close === 1915, "TWSE parse");

  const LF = String.fromCharCode(10);
  const csv = ["Date,Open,High,Low,Close,Volume", "2026-02-24,10,12,9,11,100"].join(LF);
  const st = parseStooqCSV(csv);
  console.assert(st.length === 1, "Stooq parse");

  // Backtest smoke test (monotonic up series should make trend strategy positive if it stays long)
  const fakeRows: OHLCV[] = [];
  for (let i = 0; i < 120; i++) {
    const t = "2026-01-" + String(1 + (i % 28)).padStart(2, "0");
    const base = 100 + i;
    fakeRows.push({ t: t, open: base, high: base + 1, low: base - 1, close: base, volume: 1000 });
  }
  const atr = computeATRSeries(fakeRows, 14);
  const vr = computeVolumeRatioSeries(fakeRows, 20);
  const trSig = buildBacktestSignalTrend(fakeRows, 20, 60).signal;
  const res = backtestFromSignal({
    rows: fakeRows,
    signal: trSig,
    atr: atr,
    volumeRatio: vr,
    eventCountByDate: {},
    feeBps: 0,
    slipBps: 0,
    atrStopK: 3,
    volumeGateOn: false,
    volumeGateThr: 1.0,
    eventScaleOn: false,
    eventCountThr: 10,
    eventScale: 0.5,
  });
  console.assert(res && res.stats.totalReturn > -0.5, "Backtest should run");
}

let __didRunTests = false;

export default function StockLab() {
  const todayIso = useMemo(() => dateISO(new Date()), []);
  const defaultFrom = useMemo(() => addDaysISO(todayIso, -365), [todayIso]);

  const [search, setSearch] = useState<string>("");
  const [selected, setSelected] = useState<string>("2330.TW");
  const [symbol, setSymbol] = useState<string>("2330.TW");
  const [provider, setProvider] = useState<Provider>("auto");

  const [rowsAll, setRowsAll] = useState<OHLCV[]>([]);
  const [dateFrom, setDateFrom] = useState<string>(defaultFrom);
  const [dateTo, setDateTo] = useState<string>(todayIso);

  // Chart controls: timeframe + zoom/pan
  const [tf, setTf] = useState<Timeframe>("1d");
  const [chartBars, setChartBars] = useState<number>(160);
  const [chartEnd, setChartEnd] = useState<number>(-1);
  const [chartBig, setChartBig] = useState<boolean>(false);

  // Backtest strategy controls
  const [strategy, setStrategy] = useState<StrategyId>("trend_sma");
  const [btFast, setBtFast] = useState<number>(20);
  const [btSlow, setBtSlow] = useState<number>(60);
  const [btRsiPeriod, setBtRsiPeriod] = useState<number>(14);
  const [btRsiEntry, setBtRsiEntry] = useState<number>(30);
  const [btRsiExit, setBtRsiExit] = useState<number>(50);

  const [feeBps, setFeeBps] = useState<number>(5);
  const [slipBps, setSlipBps] = useState<number>(2);
  const [atrStopK, setAtrStopK] = useState<number>(2);

  const [volumeGateOn, setVolumeGateOn] = useState<boolean>(false);
  const [volumeGateThr, setVolumeGateThr] = useState<number>(1.2);

  const [eventScaleOn, setEventScaleOn] = useState<boolean>(false);
  const [eventCountThr, setEventCountThr] = useState<number>(6);
  const [eventScale, setEventScale] = useState<number>(0.5);

  const [eventsQuery, setEventsQuery] = useState<string>("台積電");
  const [eventStrict, setEventStrict] = useState<boolean>(true);
  const [eventPreferTW, setEventPreferTW] = useState<boolean>(true);
  const [eventLang, setEventLang] = useState<EventLang>("any");
  const [eventCountry, setEventCountry] = useState<EventCountry>("any");
  const [eventMinScore, setEventMinScore] = useState<number>(3);

  const [events, setEvents] = useState<{ rows: NewsEvent[]; count: number; avgTone: number; filtered: number }>({
    rows: [],
    count: 0,
    avgTone: NaN,
    filtered: 0,
  });

  const [selectedEventIdx, setSelectedEventIdx] = useState<number>(-1);

  const [facetSel, setFacetSel] = useState<FacetId[]>(["technical", "sentiment"]);

  const [investStyle, setInvestStyle] = useState<InvestStyle>("long");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("mid");
  const [horizonYears, setHorizonYears] = useState<number>(5);
  const [maxSinglePct, setMaxSinglePct] = useState<number>(10);

  const [status, setStatus] = useState<{ tone: "neutral" | "good" | "bad" | "warn"; msg: string }>({
    tone: "neutral",
    msg: "選股後按『載入股價』；模板策略已接入回測。",
  });

  const [lastSource, setLastSource] = useState<string>("-");
  const [lastError, setLastError] = useState<string>("");
  const loadingRef = useRef<number>(0);

  useEffect(() => {
    if (!__didRunTests) {
      __didRunTests = true;
      try {
        runSelfTestsOnce();
      } catch {
        // ignore
      }
    }
  }, []);

  const filteredStocks = useMemo(() => {
    const q = (search || "").trim().toLowerCase();
    if (!q) return STOCKS;
    return STOCKS.filter((s) => {
      const a = (s.value || "").toLowerCase();
      const b = (s.label || "").toLowerCase();
      return a.indexOf(q) >= 0 || b.indexOf(q) >= 0;
    });
  }, [search]);

  useEffect(() => {
    const opt = STOCKS.find((s) => s.value === selected);
    if (!opt) return;
    setSymbol(opt.value);
    setEventsQuery(opt.defaultQuery);
    setSelectedEventIdx(-1);
  }, [selected]);

  const rows = useMemo(() => {
    if (!rowsAll.length) return [] as OHLCV[];
    const filtered = filterByDate(rowsAll, dateFrom, dateTo);
    return filtered.length ? filtered : rowsAll;
  }, [rowsAll, dateFrom, dateTo]);

  const tfEffective = useMemo(() => {
    const intraday = tf === "1h" || tf === "3h" || tf === "12h";
    if (intraday && provider !== "server") return "1d" as Timeframe;
    return tf;
  }, [tf, provider]);

  const rowsTF = useMemo(() => {
    if (tfEffective === "1w") return resampleToWeek(rows);
    return rows;
  }, [rows, tfEffective]);

  useEffect(() => {
    if (!rowsTF.length) {
      setChartEnd(-1);
      return;
    }
    setChartEnd(rowsTF.length - 1);
  }, [rowsTF.length, tfEffective, symbol, dateFrom, dateTo]);

  const rowsChart = useMemo(() => {
    if (!rowsTF.length) return [] as OHLCV[];
    const end = chartEnd < 0 ? rowsTF.length - 1 : clamp(chartEnd, 0, rowsTF.length - 1);
    const bars = clamp(chartBars, 20, Math.max(20, rowsTF.length));
    const start = Math.max(0, end - bars + 1);
    return rowsTF.slice(start, end + 1);
  }, [rowsTF, chartEnd, chartBars]);

  const chartWindowInfo = useMemo(() => {
    if (!rowsChart.length) return "";
    return rowsChart[0].t + " ~ " + rowsChart[rowsChart.length - 1].t + "（bars=" + String(rowsChart.length) + "）";
  }, [rowsChart]);

  const closes = useMemo(() => rowsChart.map((r) => r.close), [rowsChart]);
  const smaFast = useMemo(() => sma(closes, clamp(btFast, 2, 200)), [closes, btFast]);
  const smaSlow = useMemo(() => sma(closes, clamp(btSlow, 3, 400)), [closes, btSlow]);
  const rsiSeries = useMemo(() => rsi(closes, clamp(btRsiPeriod, 2, 100)), [closes, btRsiPeriod]);

  const chartData = useMemo(() => {
    if (!rowsChart.length) return [] as any[];
    const out: any[] = [];
    for (let i = 0; i < rowsChart.length; i++) {
      out.push({
        t: rowsChart[i].t,
        close: rowsChart[i].close,
        smaFast: smaFast[i],
        smaSlow: smaSlow[i],
        rsi: rsiSeries[i],
      });
    }
    return out;
  }, [rowsChart, smaFast, smaSlow, rsiSeries]);

  const lastClose = rows.length ? rows[rows.length - 1].close : NaN;

  const profile = useMemo(() => computeAssetProfile(rows, symbol), [rows, symbol]);
  const evSummary = useMemo(() => computeEventSummary(events.rows), [events.rows]);

  const facetSuggestions = useMemo(() => {
    return buildFacetSuggestions({
      symbol: symbol,
      profile: profile,
      eventSummary: evSummary,
      facets: facetSel,
    });
  }, [symbol, profile, evSummary, facetSel]);

  const investGuidance = useMemo(() => {
    return buildInvestmentGuidance({
      symbol: symbol,
      style: investStyle,
      risk: riskLevel,
      horizonYears: clamp(Number(horizonYears || 1), 1, 50),
      maxSinglePct: clamp(Number(maxSinglePct || 10), 1, 100),
      profile: profile,
      eventSummary: evSummary,
    });
  }, [symbol, investStyle, riskLevel, horizonYears, maxSinglePct, profile, evSummary]);

  const eventCountByDate = useMemo(() => buildEventCountByDate(events.rows), [events.rows]);

  // Backtest core
  const btResult = useMemo(() => {
    if (rows.length < 80) return null;

    const atrS = computeATRSeries(rows, 14);
    const vrS = computeVolumeRatioSeries(rows, 20);

    let sig: number[] = Array(rows.length).fill(0);

    if (strategy === "trend_sma") {
      sig = buildBacktestSignalTrend(rows, clamp(btFast, 2, 200), clamp(btSlow, 3, 400)).signal;
    } else {
      sig = buildBacktestSignalMeanRev(rows, clamp(btRsiPeriod, 2, 100), clamp(btRsiEntry, 1, 99), clamp(btRsiExit, 1, 99)).signal;
    }

    return backtestFromSignal({
      rows: rows,
      signal: sig,
      atr: atrS,
      volumeRatio: vrS,
      eventCountByDate: eventCountByDate,
      feeBps: clamp(feeBps, 0, 200),
      slipBps: clamp(slipBps, 0, 200),
      atrStopK: clamp(atrStopK, 0, 10),
      volumeGateOn: volumeGateOn,
      volumeGateThr: clamp(volumeGateThr, 0.5, 5),
      eventScaleOn: eventScaleOn,
      eventCountThr: clamp(eventCountThr, 1, 999),
      eventScale: clamp(eventScale, 0, 1),
    });
  }, [
    rows,
    strategy,
    btFast,
    btSlow,
    btRsiPeriod,
    btRsiEntry,
    btRsiExit,
    feeBps,
    slipBps,
    atrStopK,
    volumeGateOn,
    volumeGateThr,
    eventScaleOn,
    eventCountThr,
    eventScale,
    eventCountByDate,
  ]);

  const equityChart = useMemo(() => {
    if (!btResult) return [] as any[];
    return btResult.curve.map((p: { t: string; equity: number }) => ({ t: p.t, equity: p.equity }));
  }, [btResult]);

  function toggleFacet(id: FacetId) {
    setFacetSel((cur) => (cur.indexOf(id) >= 0 ? cur.filter((x) => x !== id) : cur.concat([id])));
  }

  function symbolToTwseNo(sym: string) {
    const u = (sym || "").toUpperCase();
    const i = u.indexOf(".");
    return i > 0 ? u.slice(0, i) : u;
  }

  async function fetchTwseMonthly(stockNo: string, y: number, m: number) {
    const mm = String(m).padStart(2, "0");
    const yyyymmdd = String(y) + mm + "01";
    const url =
      "https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=" +
      encodeURIComponent(yyyymmdd) +
      "&stockNo=" +
      encodeURIComponent(stockNo);

    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) throw new Error("TWSE HTTP " + String(resp.status));
    const j = (await resp.json()) as TwseStockDayJson;
    if (j && j.stat && String(j.stat).indexOf("OK") < 0 && String(j.stat).indexOf("Ok") < 0) {
      return [] as OHLCV[];
    }
    return parseTwseStockDayJson(j);
  }

  async function fetchTwseRange(stockNo: string, fromIso: string, toIso: string) {
    const months = iterMonths(fromIso, toIso);
    const all: OHLCV[] = [];
    for (let i = 0; i < months.length; i++) {
      const seg = await fetchTwseMonthly(stockNo, months[i].y, months[i].m);
      for (let j = 0; j < seg.length; j++) all.push(seg[j]);
    }
    const map: { [k: string]: OHLCV } = {};
    for (let i = 0; i < all.length; i++) map[all[i].t] = all[i];
    const out = Object.keys(map)
      .sort()
      .map((k) => map[k]);
    return filterByDate(out, fromIso, toIso);
  }

  async function fetchStooq(sym: string) {
    const up = (sym || "").toUpperCase();
    const opt = STOCKS.find((s) => s.value.toUpperCase() === up);
    const st = opt && opt.stooqSymbol ? opt.stooqSymbol : up.indexOf(".") > 0 ? up : up + ".US";

    const url = "https://stooq.com/q/d/l/?s=" + encodeURIComponent(st.toLowerCase()) + "&i=d";
    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) throw new Error("Stooq HTTP " + String(resp.status));
    const csv = await resp.text();
    return parseStooqCSV(csv);
  }

  async function fetchServer(sym: string, fromIso: string, toIso: string, interval?: string) {
    const url =
      "/api/marketdata?symbol=" +
      encodeURIComponent(sym) +
      "&from=" +
      encodeURIComponent(fromIso) +
      "&to=" +
      encodeURIComponent(toIso) +
      (interval ? "&interval=" + encodeURIComponent(interval) : "");

    const resp = await fetch(url, { method: "GET" });
    if (!resp.ok) throw new Error("Server HTTP " + String(resp.status));
    const j = await resp.json();
    const out = Array.isArray(j && j.rows) ? (j.rows as OHLCV[]) : [];
    return out;
  }

  async function loadPrice() {
    const sym = symbol.trim().toUpperCase();
    if (!sym) return;

    const reqId = Date.now();
    loadingRef.current = reqId;

    setLastError("");
    setStatus({ tone: "warn", msg: "股價載入中..." });

    const usedProvider: Provider = provider === "auto" ? guessProvider(sym) : provider;

    try {
      let out: OHLCV[] = [];

      if (usedProvider === "twse") {
        const no = symbolToTwseNo(sym);
        out = await fetchTwseRange(no, dateFrom, dateTo);
        if (loadingRef.current !== reqId) return;
        if (!out.length) throw new Error("TWSE returned 0 rows (range or symbol?)");
        setRowsAll(out);
        setLastSource("TWSE exchangeReport/STOCK_DAY");
        setStatus({ tone: "good", msg: "Loaded: " + sym + " rows=" + String(out.length) });
        return;
      }

      if (usedProvider === "stooq") {
        out = await fetchStooq(sym);
        if (loadingRef.current !== reqId) return;
        if (!out.length) throw new Error("Stooq returned 0 rows");
        const filtered = filterByDate(out, dateFrom, dateTo);
        const used = filtered.length ? filtered : out;
        setRowsAll(used);
        setLastSource("Stooq CSV");
        setStatus({ tone: "good", msg: "Loaded: " + sym + " rows=" + String(used.length) });
        return;
      }

      out = await fetchServer(sym, dateFrom, dateTo, tfEffective);
      if (loadingRef.current !== reqId) return;
      if (!out.length) throw new Error("Server returned 0 rows");
      setRowsAll(out);
      setLastSource("Server /api/marketdata");
      setStatus({ tone: "good", msg: "Loaded: " + sym + " rows=" + String(out.length) });
    } catch (e: any) {
      if (loadingRef.current !== reqId) return;
      const msg = String(e && e.message ? e.message : e);
      setLastError(msg);
      setLastSource("-");
      setStatus({ tone: "bad", msg: "Load failed: " + msg });
    }
  }

  function loadDemo() {
    let seed = 7;
    function rng() {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return ((seed >>> 0) % 1000000) / 1000000;
    }

    const out: OHLCV[] = [];
    let p0 = 140;
    const d = new Date();
    d.setDate(d.getDate() - 380);

    for (let i = 0; i < 380; i++) {
      const shock = (rng() - 0.5) * 2;
      const rr = 0.00035 + 0.012 * shock;
      const prev = p0;
      p0 = Math.max(1, p0 * (1 + rr));
      const hi = Math.max(prev, p0) * (1 + rng() * 0.006);
      const lo = Math.min(prev, p0) * (1 - rng() * 0.006);
      const op = prev * (1 + (rng() - 0.5) * 0.003);
      const cl = p0;
      const volu = Math.round(1e6 * (0.6 + rng() * 1.2));

      d.setDate(d.getDate() + 1);
      out.push({ t: dateISO(d), open: op, high: hi, low: lo, close: cl, volume: volu });
    }

    setRowsAll(filterByDate(out, dateFrom, dateTo));
    setLastSource("DEMO");
    setLastError("");
    setStatus({ tone: "warn", msg: "Loaded DEMO data" });
  }

  function safeOpen(url: string) {
    const u = normalizeHttpUrl(url);
    if (!u) return;
    if (typeof window !== "undefined") window.open(u, "_blank", "noopener,noreferrer");
  }

  async function copyUrl(url: string) {
    const u = normalizeHttpUrl(url);
    if (!u) return;
    try {
      if (typeof navigator !== "undefined" && (navigator as any).clipboard && (navigator as any).clipboard.writeText) {
        await (navigator as any).clipboard.writeText(u);
        setStatus({ tone: "good", msg: "已複製連結" });
      } else {
        setStatus({ tone: "warn", msg: "瀏覽器不支援 clipboard，請手動複製" });
      }
    } catch {
      setStatus({ tone: "warn", msg: "複製失敗，請手動複製" });
    }
  }

  async function loadEvents() {
    const sym = symbol.trim().toUpperCase();
    const q0 = (eventsQuery || "").trim();
    if (!q0 || !dateFrom || !dateTo) return;

    setStatus({ tone: "warn", msg: "抓事件中..." });

    try {
      const clamped = clampGdeltRange(dateFrom, dateTo, todayIso);
      const usedFrom = clamped.from;
      const usedTo = clamped.to;

      const start = toGdeltDatetime(usedFrom, "000000");
      const end = toGdeltDatetime(usedTo, "235959");

      const syn = getEventSynonyms(sym, q0);

      let query = "";
      if (syn.advanced) query = syn.raw;
      else query = "(" + buildGdeltOrTerms(syn.terms, eventStrict, false).join(" OR ") + ")";

      const url =
        "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
        encodeURIComponent(query) +
        "&mode=artlist&format=json&sort=datedesc&maxrecords=200&startdatetime=" +
        start +
        "&enddatetime=" +
        end;

      let j: any = null;
      try {
        j = await fetchJsonLoose(url);
      } catch (e: any) {
        const msg = String(e && e.message ? e.message : e);
        if (!syn.advanced && msg.toLowerCase().indexOf("phrase is too short") >= 0) {
          const retryQuery = "(" + buildGdeltOrTerms(syn.terms, false, true).join(" OR ") + ")";
          const retryUrl =
            "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
            encodeURIComponent(retryQuery) +
            "&mode=artlist&format=json&sort=datedesc&maxrecords=200&startdatetime=" +
            start +
            "&enddatetime=" +
            end;
          j = await fetchJsonLoose(retryUrl);
          setStatus({ tone: "warn", msg: "Events retry: relaxed query" });
        } else {
          throw e;
        }
      }

      const arts = j && Array.isArray(j.articles) ? j.articles : [];

      const norm0: NewsEvent[] = arts
        .map((a: any) => ({
          seendate: a && a.seendate ? String(a.seendate) : undefined,
          title: a && a.title ? String(a.title) : "",
          url: normalizeHttpUrl(a && a.url ? String(a.url) : ""),
          domain: a && a.domain ? String(a.domain) : undefined,
          language: a && a.language ? String(a.language) : undefined,
          sourceCountry: a && a.sourcecountry ? String(a.sourcecountry) : undefined,
          tone: Number.isFinite(Number(a && a.tone)) ? Number(a.tone) : undefined,
        }))
        .filter((x: any) => x.title && x.url);

      const termsForScoring = syn.advanced ? [q0] : syn.terms;

      const scored: NewsEvent[] = [];
      for (let i = 0; i < norm0.length; i++) {
        const a = norm0[i];
        if (!passLangCountry(a, eventLang, eventCountry)) continue;
        const s = scoreArticle(a, termsForScoring, eventPreferTW);
        if (s >= clamp(Number(eventMinScore || 0), 0, 999)) scored.push({ ...a, score: s });
      }

      scored.sort((a, b) => {
        const sa = Number(a.score || 0);
        const sb = Number(b.score || 0);
        if (sb !== sa) return sb - sa;
        const da = String(a.seendate || "");
        const db = String(b.seendate || "");
        return db < da ? -1 : db > da ? 1 : 0;
      });

      const tones = scored.map((x) => (typeof x.tone === "number" ? x.tone : NaN)).filter((x) => Number.isFinite(x));
      const avgTone = tones.length ? mean(tones) : NaN;

      const filteredCount = Math.max(0, norm0.length - scored.length);
      setEvents({ rows: scored, count: scored.length, avgTone: avgTone, filtered: filteredCount });

      let note = "Events loaded: " + String(scored.length) + " (filtered " + String(filteredCount) + ")";
      if (usedFrom !== dateFrom || usedTo !== dateTo) note += " | clamped to " + usedFrom + " ~ " + usedTo;

      setStatus({ tone: "good", msg: note });
    } catch (e: any) {
      setEvents({ rows: [], count: 0, avgTone: NaN, filtered: 0 });
      setStatus({ tone: "bad", msg: "Events failed: " + String(e && e.message ? e.message : e) });
    }
  }

  const dataOk = rows.length >= 80;
  const volumeNote = symbol.toUpperCase().indexOf(".TW") > 0 ? "台股 volume=股數；若要轉張可除以 1000。" : "";

  const winRate = useMemo(() => {
    if (!btResult) return NaN;
    const denom = btResult.wins + btResult.losses;
    return denom > 0 ? btResult.wins / denom : NaN;
  }, [btResult]);

  function handleChartWheel(e: React.WheelEvent) {
    if (!rowsTF.length) return;

    // Note: In some environments wheel listeners are passive; if preventDefault is ignored,
    // the page may scroll. It's still useful for zoom/pan.
    if (e.cancelable) e.preventDefault();

    const end0 = chartEnd < 0 ? rowsTF.length - 1 : clamp(chartEnd, 0, rowsTF.length - 1);
    const barsMax = Math.max(20, Math.min(520, rowsTF.length));
    const bars0 = clamp(chartBars, 20, barsMax);

    const dir = e.deltaY > 0 ? 1 : -1; // down: +1, up: -1

    if (e.shiftKey) {
      // Pan
      const step = Math.max(1, Math.round(bars0 * 0.06));
      const end1 = clamp(end0 + dir * step, 0, rowsTF.length - 1);
      setChartEnd(end1);
      return;
    }

    // Zoom
    const frac = e.ctrlKey || e.metaKey ? 0.2 : 0.1;
    const delta = Math.max(1, Math.round(bars0 * frac));
    const bars1 = clamp(bars0 + dir * delta, 20, barsMax);

    setChartBars(bars1);
    // keep end anchored
    setChartEnd(end0);
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-2xl font-bold text-slate-900">StockLab</div>
              <div className="mt-1 text-sm text-slate-600">
                真實股價 + 真實事件 + 模板策略回測
                <span className="ml-2">
                  <Badge tone="warn">Not Financial Advice</Badge>
                </span>
              </div>
            </div>
            <Badge tone={status.tone}>{status.msg}</Badge>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge tone="neutral">Source: {lastSource}</Badge>
            {lastError ? <Badge tone="bad">Error: {lastError}</Badge> : null}
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <div className="text-xs text-slate-600">股票清單搜尋</div>
              <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder="輸入代號或名稱" />
              <div className="mt-2 text-xs text-slate-600">股票下拉選單</div>
              <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={selected} onChange={(e) => setSelected(e.currentTarget.value)}>
                <optgroup label="台股 / ETF">
                  {filteredStocks
                    .filter((s) => s.value.indexOf(".TW") > 0)
                    .map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                </optgroup>
                <optgroup label="美股 / ETF">
                  {filteredStocks
                    .filter((s) => s.value.indexOf(".TW") < 0)
                    .map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                </optgroup>
              </select>
            </div>

            <div className="md:col-span-3">
              <div className="text-xs text-slate-600">Symbol（可自訂）</div>
              <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={symbol} onChange={(e) => setSymbol(e.currentTarget.value.toUpperCase())} />
              <div className="mt-2 text-xs text-slate-600">Provider</div>
              <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={provider} onChange={(e) => setProvider(e.currentTarget.value as Provider)}>
                <option value="auto">Auto（台股用 TWSE，其它用 Stooq）</option>
                <option value="twse">TWSE（台股官方歷史）</option>
                <option value="stooq">Stooq（美股/ETF）</option>
                <option value="server">Server (/api/marketdata)（需你自己做後端）</option>
              </select>
            </div>

            <div className="md:col-span-3">
              <div className="text-xs text-slate-600">From</div>
              <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.currentTarget.value)} />
              <div className="mt-2 text-xs text-slate-600">To</div>
              <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" type="date" value={dateTo} onChange={(e) => setDateTo(e.currentTarget.value)} />
            </div>

            <div className="md:col-span-2 flex flex-col justify-end gap-2">
              <button className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={loadPrice}>
                載入股價
              </button>
              <button className="w-full rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-800" onClick={loadDemo}>
                載入示範資料
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold text-slate-900">模板策略回測（Backtest templates）</div>
              <Badge tone={dataOk ? "good" : "warn"}>{dataOk ? "OK" : "資料不足（建議 ≥80 天）"}</Badge>
            </div>

            <div className="mt-3 grid gap-3 md:grid-cols-12">
              <div className="md:col-span-4">
                <div className="text-xs text-slate-600">策略（Strategy）</div>
                <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={strategy} onChange={(e) => setStrategy(e.currentTarget.value as StrategyId)}>
                  <option value="trend_sma">趨勢策略（Trend）｜SMA20 / SMA60</option>
                  <option value="meanrev_rsi">均值回歸（Mean Reversion）｜RSI</option>
                </select>
              </div>

              <div className="md:col-span-8 grid gap-2 sm:grid-cols-4">
                {strategy === "trend_sma" ? (
                  <>
                    <label className="text-xs text-slate-600">
                      SMA fast
                      <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={btFast} onChange={(e) => setBtFast(Number(e.currentTarget.value))} />
                    </label>
                    <label className="text-xs text-slate-600">
                      SMA slow
                      <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={btSlow} onChange={(e) => setBtSlow(Number(e.currentTarget.value))} />
                    </label>
                    <div />
                    <div />
                  </>
                ) : (
                  <>
                    <label className="text-xs text-slate-600">
                      RSI period
                      <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={btRsiPeriod} onChange={(e) => setBtRsiPeriod(Number(e.currentTarget.value))} />
                    </label>
                    <label className="text-xs text-slate-600">
                      RSI entry (&lt;)
                      <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={btRsiEntry} onChange={(e) => setBtRsiEntry(Number(e.currentTarget.value))} />
                    </label>
                    <label className="text-xs text-slate-600">
                      RSI exit (&gt;)
                      <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={btRsiExit} onChange={(e) => setBtRsiExit(Number(e.currentTarget.value))} />
                    </label>
                    <div />
                  </>
                )}
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <label className="text-xs text-slate-600">
                fee (bps)
                <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={feeBps} onChange={(e) => setFeeBps(Number(e.currentTarget.value))} />
              </label>
              <label className="text-xs text-slate-600">
                slippage (bps)
                <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={slipBps} onChange={(e) => setSlipBps(Number(e.currentTarget.value))} />
              </label>
              <label className="text-xs text-slate-600">
                ATR stop k
                <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={atrStopK} onChange={(e) => setAtrStopK(Number(e.currentTarget.value))} />
              </label>
              <div className="text-xs text-slate-600">
                {volumeNote}
                <div className="mt-1 text-slate-500">執行假設：以「次日收盤」近似成交（避免偷看未來）。也就是第 i 日持倉由第 i-1 日訊號決定。</div>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm">
                <input type="checkbox" checked={volumeGateOn} onChange={() => setVolumeGateOn(!volumeGateOn)} />
                <span className="text-slate-800">Volume gate</span>
              </label>
              <label className="text-xs text-slate-600">
                volRatio threshold
                <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={volumeGateThr} onChange={(e) => setVolumeGateThr(Number(e.currentTarget.value))} />
              </label>
              <div className="text-xs text-slate-600">只限制新進場；持倉中不會因 gate 變低而強制出場。</div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm">
                <input type="checkbox" checked={eventScaleOn} onChange={() => setEventScaleOn(!eventScaleOn)} />
                <span className="text-slate-800">Event-day scaling</span>
              </label>
              <label className="text-xs text-slate-600">
                event count threshold
                <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={eventCountThr} onChange={(e) => setEventCountThr(Number(e.currentTarget.value))} />
              </label>
              <label className="text-xs text-slate-600">
                scale (0~1)
                <input className="mt-1 w-full rounded-xl border bg-white px-2 py-1 text-sm" type="number" value={eventScale} onChange={(e) => setEventScale(Number(e.currentTarget.value))} />
              </label>
              <div className="text-xs text-slate-600">事件日曝險縮放是「不交易」的軟手段，適合回測。</div>
            </div>

            <details className="mt-4 rounded-2xl border bg-white p-4">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">這一區塊怎麼用？（模板策略回測引導）</summary>
              <div className="mt-3 space-y-4 text-sm text-slate-700">
                <div>
                  <div className="font-semibold text-slate-900">1) 先確定資料與區間</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li>先按「載入股價」，並選一段你真的想研究的日期區間。</li>
                    <li>建議至少 80 個交易日，太短會讓 SMA / RSI / ATR 不穩。</li>
                  </ul>
                </div>

                <div>
                  <div className="font-semibold text-slate-900">2) 選策略模板（你其實是在選假設）</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li><b>趨勢策略（Trend｜SMA）</b>：假設行情會延續方向；單邊趨勢常較吃香。</li>
                    <li><b>均值回歸（Mean Reversion｜RSI）</b>：假設價格會回到均值；盤整較可能有 edge，但更吃成本。</li>
                  </ul>
                </div>

                <div>
                  <div className="font-semibold text-slate-900">3) 先把「現實成本」打開</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li><b>fee / slippage（bps）</b>：短線策略的天敵。成本設太低，回測會變成幻想。</li>
                    <li>如果 trades 很高，但 total return 沒變好，通常就是成本把你吃掉。</li>
                  </ul>
                </div>

                <div>
                  <div className="font-semibold text-slate-900">4) 用 ATR stop 做風控</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li><b>ATR stop k</b>：停損距離約等於 k × ATR（波動越大，停損距離越大）。</li>
                    <li>k 太小會常被洗掉；k 太大回撤會變深。用回測找平衡。</li>
                  </ul>
                </div>

                <div>
                  <div className="font-semibold text-slate-900">5) 兩個可選的研究工具</div>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    <li><b>Volume gate</b>：只在量能夠（volRatio &gt;= 門檻）時允許新進場，避免低量假訊號。</li>
                    <li><b>Event-day scaling</b>：事件多（不確定性高）的日子，把曝險縮小到 scale（例如 0.5）。</li>
                  </ul>
                </div>

                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  建議比較法：同一段資料只改 1 個開關（例如只開 event-day scaling），看 Sharpe 與 Max DD 是否改善。
                </div>
              </div>
            </details>

            {btResult ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                <StatCard title="Total return" value={fmtPct(btResult.stats.totalReturn)} sub={"總報酬（最後 equity - 1）｜成本=" + String(btResult.stats.costBps) + " bps"} />
                <StatCard title="CAGR" value={fmtPct(btResult.stats.cagr)} sub="年化報酬（Annualized）" />
                <StatCard title="Sharpe" value={fmtNum(btResult.stats.sharpe, 2)} sub="風險調整後報酬（越高通常越好）" />
                <StatCard title="Max DD" value={fmtPct(btResult.stats.maxDrawdown)} sub="最大回撤（Peak-to-trough，越接近 0 越好）" />
                <StatCard title="Trades" value={String(btResult.trades)} sub="交易次數（進出場都算 1 次）" />
                <StatCard title="Win rate" value={Number.isFinite(winRate) ? (winRate * 100).toFixed(1) + "%" : "-"} sub={"勝率不是越高越好｜W=" + String(btResult.wins) + " L=" + String(btResult.losses)} />
              </div>
            ) : (
              <div className="mt-3 text-sm text-slate-600">載入股價後（建議資料≥80天），回測結果會出現在這裡。</div>
            )}
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7 rounded-2xl border bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold text-slate-900">K 線（Candlestick）+ 指標</div>
              <Badge tone="neutral">SMA/RSI</Badge>
            </div>

            <div className="mt-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-slate-800">K 線（紅綠 + 長影線）</div>
                <div className="text-xs text-slate-500">滑鼠移到圖上可看 OHLC｜{chartWindowInfo}</div>
              </div>

              <div className="mb-3 rounded-2xl border bg-slate-50 p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="text-xs text-slate-600">
                    時間尺度（Timeframe）
                    <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={tf} onChange={(e) => setTf(e.currentTarget.value as Timeframe)}>
                      <option value="1h">1 小時（1H，需 Server）</option>
                      <option value="3h">3 小時（3H，需 Server）</option>
                      <option value="12h">半天（12H，需 Server）</option>
                      <option value="1d">24 小時（1D / 日線）</option>
                      <option value="1w">1 週（1W / 週線）</option>
                    </select>
                  </label>

                  <label className="text-xs text-slate-600">
                    顯示 K 棒數（Zoom）
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={20}
                      max={Math.max(20, Math.min(520, rowsTF.length || 0))}
                      value={clamp(chartBars, 20, Math.max(20, Math.min(520, rowsTF.length || 0)))}
                      onChange={(e) => setChartBars(Number(e.currentTarget.value))}
                    />
                    <div className="mt-1 text-[11px] text-slate-500">目前：{chartBars} 根</div>
                  </label>

                  <label className="text-xs text-slate-600">
                    視窗位置（Pan）
                    <input
                      className="mt-2 w-full"
                      type="range"
                      min={0}
                      max={Math.max(0, (rowsTF.length || 1) - 1)}
                      value={chartEnd < 0 ? Math.max(0, (rowsTF.length || 1) - 1) : clamp(chartEnd, 0, Math.max(0, (rowsTF.length || 1) - 1))}
                      onChange={(e) => setChartEnd(Number(e.currentTarget.value))}
                      disabled={!rowsTF.length}
                    />
                    <div className="mt-1 text-[11px] text-slate-500">末端：{rowsTF.length ? (chartEnd < 0 ? rowsTF.length - 1 : chartEnd) : 0}</div>
                  </label>

                  <div className="flex items-end gap-2">
                    <button
                      className="w-full rounded-xl border bg-white px-3 py-2 text-sm font-medium text-slate-800"
                      onClick={() => {
                        setChartBars(160);
                        setChartEnd(rowsTF.length ? rowsTF.length - 1 : -1);
                      }}
                    >
                      重置
                    </button>
                    <button
                      className="w-full rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white"
                      onClick={() => setChartBig(!chartBig)}
                    >
                      {chartBig ? "縮小" : "放大"}
                    </button>
                  </div>
                </div>

                {tf !== tfEffective ? (
                  <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                    小時尺度需要 <b>Server</b> provider 支援（例如 /api/marketdata?interval=1h）。目前先用「24 小時（1D）」顯示。
                  </div>
                ) : null}

                <div className="mt-2 text-[11px] text-slate-500">
                  小技巧：Zoom 先縮小到 60~160 根，再用 Pan 左右移動，會比拖拉更穩定。
                </div>
              </div>

              <div className={chartBig ? "h-[720px]" : "h-[520px]"} onWheel={handleChartWheel}>
                <CandlestickPanel rows={rowsChart} smaFast={smaFast} smaSlow={smaSlow} />
              </div>
              <div className="mt-2 text-[11px] text-slate-500">滑鼠滾輪：縮放（Zoom）｜Shift + 滾輪：平移（Pan）｜Ctrl/⌘ + 滾輪：快速縮放</div>
            </div>

            <div className="mt-4 h-[160px]">
              <div className="mb-2 text-sm font-semibold text-slate-800">RSI(14)</div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={35} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip />
                  <ReferenceLine y={30} strokeDasharray="3 3" />
                  <ReferenceLine y={70} strokeDasharray="3 3" />
                  <Line type="monotone" dataKey="rsi" dot={false} name="RSI" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-4 h-[220px]">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-800">Equity curve</div>
                <Badge tone={btResult ? "good" : "warn"}>{btResult ? "Backtest" : "n/a"}</Badge>
              </div>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityChart} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={35} />
                  <YAxis domain={["auto", "auto"]} />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="equity" dot={false} name="equity" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard title="Last close" value={fmtNum(lastClose, 2)} sub={rows.length ? rows[rows.length - 1].t : ""} />
              <StatCard title="Rows" value={String(rows.length)} sub={dataOk ? "OK" : "<80"} />
              <StatCard title="Trend" value={profile ? (profile.trend === "up" ? "Up" : profile.trend === "down" ? "Down" : "Side") : "-"} sub={profile && Number.isFinite(profile.trendStrength) ? "sma20/sma60=" + fmtPct(profile.trendStrength) : ""} />
              <StatCard title="Vol20" value={profile && Number.isFinite(profile.vol20) ? fmtPct(profile.vol20) : "-"} sub={profile && Number.isFinite(profile.dd90) ? "dd90=" + fmtPct(profile.dd90) : ""} />
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-slate-900">真實事件（GDELT）</div>
                <button className="rounded-xl bg-slate-900 px-3 py-2 text-sm font-medium text-white" onClick={loadEvents}>
                  抓事件
                </button>
              </div>

              <div className="mt-3">
                <div className="text-xs text-slate-600">Query</div>
                <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={eventsQuery} onChange={(e) => setEventsQuery(e.currentTarget.value)} />
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm">
                  <input type="checkbox" checked={eventStrict} onChange={() => setEventStrict(!eventStrict)} />
                  <span className="text-slate-800">嚴格比對</span>
                </label>
                <label className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm">
                  <input type="checkbox" checked={eventPreferTW} onChange={() => setEventPreferTW(!eventPreferTW)} />
                  <span className="text-slate-800">來源優先（台灣）</span>
                </label>
                <label className="text-xs text-slate-600">
                  語言
                  <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={eventLang} onChange={(e) => setEventLang(e.currentTarget.value as EventLang)}>
                    <option value="any">Any</option>
                    <option value="chinese">Chinese</option>
                    <option value="english">English</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  來源國家
                  <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={eventCountry} onChange={(e) => setEventCountry(e.currentTarget.value as EventCountry)}>
                    <option value="any">Any</option>
                    <option value="twn">Taiwan</option>
                    <option value="usa">USA</option>
                    <option value="chn">China</option>
                  </select>
                </label>
              </div>

              <div className="mt-3">
                <div className="text-xs text-slate-600">雜訊門檻（Min score）</div>
                <input className="mt-1 w-full" type="range" min={0} max={12} value={eventMinScore} onChange={(e) => setEventMinScore(Number(e.currentTarget.value))} />
                <div className="text-xs text-slate-500">目前：{eventMinScore}</div>
              </div>

              <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
                顯示：{events.count}；過濾：{events.filtered}；平均 tone：{Number.isFinite(events.avgTone) ? events.avgTone.toFixed(2) : "-"}
              </div>

              <div className="mt-3 max-h-[260px] overflow-auto rounded-xl border bg-white">
                {events.rows.length === 0 ? (
                  <div className="p-3 text-sm text-slate-500">尚無事件（按「抓事件」）</div>
                ) : (
                  <ul className="divide-y">
                    {events.rows.slice(0, 60).map((e, idx) => (
                      <li key={idx} className="p-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-xs text-slate-500">{e.seendate || ""}</div>
                          <div className="flex items-center gap-2 text-xs">
                            {e.domain ? <Badge tone="neutral">{e.domain}</Badge> : null}
                            {e.language ? <Badge tone="neutral">{e.language}</Badge> : null}
                            {e.sourceCountry ? <Badge tone="neutral">{e.sourceCountry}</Badge> : null}
                            {typeof e.score === "number" ? <Badge tone={e.score >= 6 ? "good" : "neutral"}>score {e.score}</Badge> : null}
                          </div>
                        </div>

                        <div className="mt-1 text-sm font-medium text-slate-900">{e.title}</div>

                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white" onClick={() => safeOpen(e.url)}>
                            開啟
                          </button>
                          <button className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-800" onClick={() => copyUrl(e.url)}>
                            複製連結
                          </button>
                          <button className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-800" onClick={() => setSelectedEventIdx(idx)}>
                            影響分析
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {selectedEventIdx >= 0 && selectedEventIdx < events.rows.length ? (
                <div className="mt-4 rounded-2xl border bg-slate-50 p-3">
                  {(() => {
                    const ev = events.rows[selectedEventIdx];
                    const iso = parseEventDateToIsoForMap(ev.seendate);
                    const cnt = iso ? eventCountByDate[iso] || 0 : 0;
                    return (
                      <div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-slate-900">事件摘要</div>
                          <button className="rounded-lg border bg-white px-3 py-1.5 text-xs font-medium text-slate-800" onClick={() => setSelectedEventIdx(-1)}>
                            關閉
                          </button>
                        </div>
                        <div className="mt-2 text-sm font-medium text-slate-900">{ev.title}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          {iso ? <Badge tone="neutral">date {iso}</Badge> : <Badge tone="warn">date n/a</Badge>}
                          <Badge tone={cnt >= eventCountThr ? "warn" : "neutral"}>eventCount {cnt}</Badge>
                          {typeof ev.tone === "number" ? <Badge tone="neutral">tone {ev.tone.toFixed(2)}</Badge> : null}
                        </div>
                        <div className="mt-2 text-xs text-slate-600">提示：你可以用 event-day scaling，讓事件日曝險下降，測試是否降低回撤。</div>
                      </div>
                    );
                  })()}
                </div>
              ) : null}

              <div className="mt-3 text-xs text-slate-500">提示：事件查詢自動限制在近 90 天。</div>
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-slate-900">Facet 建議（研究用提示）</div>
                <Badge tone="warn">Non-advice</Badge>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {FACETS.map((f) => (
                  <label key={f.id} className="flex items-center gap-2 rounded-xl border bg-white px-3 py-2 text-sm">
                    <input type="checkbox" checked={facetSel.indexOf(f.id) >= 0} onChange={() => toggleFacet(f.id)} />
                    <span className="text-slate-800">
                      {f.zh} <span className="text-xs text-slate-500">({f.en})</span>
                    </span>
                  </label>
                ))}
              </div>

              <div className="mt-4 space-y-3">
                {facetSuggestions.map((sec, i) => (
                  <div key={i} className="rounded-2xl border bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">{sec.title}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {sec.items.map((it, j) => (
                        <li key={j}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold text-slate-900">投資框架建議（教育用途）</div>
                <Badge tone="warn">Not Financial Advice</Badge>
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="text-xs text-slate-600">
                  投資風格（Style）
                  <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={investStyle} onChange={(e) => setInvestStyle(e.currentTarget.value as InvestStyle)}>
                    <option value="long">長期（Long-term）</option>
                    <option value="swing">波段（Swing）</option>
                    <option value="day">短線（Short-term）</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  風險承受度（Risk）
                  <select className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={riskLevel} onChange={(e) => setRiskLevel(e.currentTarget.value as RiskLevel)}>
                    <option value="low">保守（Low）</option>
                    <option value="mid">中性（Mid）</option>
                    <option value="high">積極（High）</option>
                  </select>
                </label>
                <label className="text-xs text-slate-600">
                  期限（Years）
                  <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" type="number" value={horizonYears} onChange={(e) => setHorizonYears(Number(e.currentTarget.value))} />
                </label>
                <label className="text-xs text-slate-600">
                  單一標的上限（%）
                  <input className="mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm" type="number" value={maxSinglePct} onChange={(e) => setMaxSinglePct(Number(e.currentTarget.value))} />
                </label>
              </div>

              <div className="mt-4 space-y-3">
                {investGuidance.map((sec, i) => (
                  <div key={i} className="rounded-2xl border bg-slate-50 p-3">
                    <div className="text-sm font-semibold text-slate-900">{sec.title}</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
                      {sec.items.map((it, j) => (
                        <li key={j}>{it}</li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              <div className="mt-3 text-xs text-slate-500">注意：本頁回測是教學級（僅日線、簡化成交/停損）。真正交易需更嚴謹的成交模型與資料源。</div>

              <details className="mt-4 rounded-2xl border bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">解讀引導（名詞 + 怎麼看結果）</summary>
                <div className="mt-3 space-y-4 text-sm text-slate-700">
                  <div>
                    <div className="font-semibold text-slate-900">快速上手（3 步）</div>
                    <ol className="mt-2 list-decimal space-y-1 pl-5">
                      <li>先按「載入股價」，區間建議至少 80 個交易日（資料太短會讓指標不穩）。</li>
                      <li>選策略：趨勢策略適合有趨勢的走勢；均值回歸更偏盤整，但更吃成本。</li>
                      <li>看 3 個東西：Equity curve（資產曲線）、Max DD（最大回撤）、Sharpe（風險調整後報酬）。</li>
                    </ol>
                  </div>

                  <div>
                    <div className="font-semibold text-slate-900">回測指標怎麼讀</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li><b>Equity curve</b>：模擬資產淨值（equity）。平滑上行通常比鋸齒大起大落更健康。</li>
                      <li><b>Total return</b>：整段區間的總報酬（最後 equity - 1）。</li>
                      <li><b>CAGR</b>（Compound Annual Growth Rate）：把總報酬換算成「年化」的近似，方便不同期間比較。</li>
                      <li><b>Sharpe</b>：平均日報酬 / 日波動 × √252（近似）。一般來說越高越好，但很容易被過擬合騙。</li>
                      <li><b>Max DD</b>（Maximum Drawdown）：從高點到低點的最大跌幅（越接近 0 越好）。這通常比勝率更關鍵。</li>
                      <li><b>Trades</b>：交易次數（進場、出場、停損都算）。交易太多通常表示成本很致命。</li>
                      <li><b>Win rate</b>：勝率。注意：勝率高不代表賺錢（可能小賺大賠）；要搭配回撤與 equity 看。</li>
                    </ul>
                  </div>

                  <div>
                    <div className="font-semibold text-slate-900">參數與名詞（Glossary）</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      <li><b>SMA</b>（Simple Moving Average，簡單移動平均）：過去 N 天收盤平均。SMA20/SMA60 用來判定趨勢。</li>
                      <li><b>RSI</b>（Relative Strength Index，相對強弱指標）：0~100。常見經驗值：RSI &lt; 30 視為超賣、RSI &gt; 70 視為超買（但不是必反轉）。</li>
                      <li><b>ATR</b>（Average True Range，平均真實波幅）：衡量波動的「距離」。ATR stop k 表示停損距離≈k×ATR。</li>
                      <li><b>bps</b>（basis points，基點）：1 bps = 0.01%。fee/slippage 用 bps 比較方便。</li>
                      <li><b>slippage</b>（滑價）：理想成交價與實際成交價的差。短線策略最怕這個。</li>
                      <li><b>Volume gate</b>：量能門檻。這裡用 volRatio（今日量/近 20 日均量）判斷「量是否夠」。只限制新進場。</li>
                      <li><b>Event-day scaling</b>：事件日曝險縮放。當某一天事件數量很高（代表資訊噪聲/不確定性上升）時，把當天曝險降低到 scale（例如 0.5）。這是「軟風控」很適合回測。</li>
                    </ul>
                  </div>

                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    小提醒：回測最常見的陷阱是 overfitting（過擬合）。你調到很漂亮的 Sharpe，可能只是剛好吃到那段期間的運氣。建議用不同日期區間做對照（walk-forward）。
                  </div>
                </div>
              </details>
            </div>
          </div>
        </div>

        <footer className="rounded-2xl border bg-white p-4 text-xs text-slate-600 shadow-sm">
          <div className="font-semibold text-slate-800">下一步可以更硬核</div>
          <div className="mt-2">如果你要論文級 event study：加上基準（例如 0050 或 SPY）計算 AR/CAR，並把事件分類當 treatment 做分組比較。</div>
        </footer>
      </div>
    </div>
  );
}
