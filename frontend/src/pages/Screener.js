import React, { useState, useEffect, useMemo } from "react";
import { fetchDailyScreener } from "../services/api";

const MA_FILTERS = [
  { key: "ma200", label: "200 MA" },
  { key: "ma150", label: "150 MA" },
  { key: "ma50",  label: "50 MA"  },
];

const COLUMNS = [
  { key: "rank",           label: "#" },
  { key: "symbol",         label: "Symbol" },
  { key: "price",          label: "Price" },
  { key: "ma50",           label: "MA50" },
  { key: "ma150",          label: "MA150" },
  { key: "ma200",          label: "MA200" },
  { key: "high_52w",       label: "52W Hi" },
  { key: "low_52w",        label: "52W Lo" },
  { key: "days_from_high", label: "D↓Hi" },
  { key: "days_from_low",  label: "D↑Lo" },
  { key: "pct_from_high",  label: "%↓Hi" },
  { key: "pct_from_low",   label: "%↑Lo" },
  { key: "beta",           label: "Beta" },
  { key: "composite_score",label: "Score" },
  { key: "ma200_vs_ma150", label: "200/150" },
  { key: "ma200_vs_ma50",  label: "200/50" },
  { key: "ma150_vs_ma50",  label: "150/50" },
];

const TD = { padding: "3px 6px", whiteSpace: "nowrap", fontSize: 12 };

function dirArrow(dir) {
  if (dir === "up")   return <span style={{ color: "#2e7d32" }}>▲</span>;
  if (dir === "down") return <span style={{ color: "#c62828" }}>▼</span>;
  return <span style={{ color: "#999" }}>—</span>;
}

function maDiffColor(v) {
  if (v == null) return "#999";
  const abs = Math.abs(v);
  if (abs < 1) return "#2e7d32";
  if (abs < 3) return "#e65100";
  return "#555";
}

export default function Screener() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filters, setFilters] = useState({ ma200: null, ma150: null, ma50: null });
  const [sort, setSort]       = useState({ key: "rank", dir: "asc" });

  useEffect(() => {
    fetchDailyScreener()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleFilter(maKey, dir) {
    setFilters(f => ({ ...f, [maKey]: f[maKey] === dir ? null : dir }));
  }

  function handleSort(key) {
    setSort(s => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }));
  }

  const filtered = useMemo(() => {
    if (!data?.stocks) return [];
    return data.stocks.filter(s => {
      for (const { key } of MA_FILTERS) {
        const f = filters[key];
        if (f && s[`${key}_dir`] !== f) return false;
      }
      return true;
    });
  }, [data, filters]);

  const sorted = useMemo(() => {
    const { key, dir } = sort;
    return [...filtered].sort((a, b) => {
      const av = a[key] ?? Infinity;
      const bv = b[key] ?? Infinity;
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ?  1 : -1;
      return 0;
    });
  }, [filtered, sort]);

  if (loading) return <div style={{ padding: 24 }}>Loading screener…</div>;
  if (error)   return <div style={{ padding: 24, color: "red" }}>Error: {error}</div>;

  return (
    <div style={{ padding: 16, overflowX: "auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <h3 style={{ margin: 0 }}>📊 Daily Screener</h3>
        <span style={{ color: "#666", fontSize: 13 }}>
          {data.fallback && <span style={{ color: "#e65100", marginRight: 8 }}>⚠ Using {data.data_date} (today's pipeline not run yet)</span>}
          {sorted.length} / {data.stocks.length} stocks
        </span>
      </div>

      {/* Filter toggles */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {MA_FILTERS.map(({ key, label }) => (
          <React.Fragment key={key}>
            {["up", "down"].map(dir => {
              const active = filters[key] === dir;
              return (
                <button key={dir} onClick={() => toggleFilter(key, dir)} style={{
                  padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13,
                  border: active ? "2px solid #1976d2" : "1px solid #bbb",
                  background: active ? "#e3f2fd" : "#fff",
                  color: active ? "#1565c0" : "#555",
                  fontWeight: active ? "bold" : "normal",
                }}>
                  {label} {dir === "up" ? "▲" : "▼"}
                </button>
              );
            })}
          </React.Fragment>
        ))}
        <button onClick={() => setFilters({ ma200: null, ma150: null, ma50: null })} style={{
          padding: "4px 12px", borderRadius: 4, cursor: "pointer", fontSize: 13,
          border: "1px solid #bbb", background: "#f5f5f5",
        }}>Reset</button>
      </div>

      {/* Table */}
      <div style={{ overflowX: "auto", width: "100%" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, tableLayout: "auto" }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {COLUMNS.map(({ key, label }) => (
                <th key={key} onClick={() => handleSort(key)} style={{
                  ...TD, border: "1px solid #ddd", cursor: "pointer",
                  userSelect: "none", background: "#f5f5f5",
                  color: sort.key === key ? "#1976d2" : "#333",
                  fontWeight: "bold",
                }}>
                  {label}{sort.key === key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.symbol} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ ...TD, textAlign: "center" }}>{s.rank}</td>
                <td style={{ ...TD, fontWeight: "bold" }}>{s.symbol}</td>
                <td style={{ ...TD, textAlign: "right" }}>${s.price?.toFixed(2)}</td>
                {/* MA50 */}
                <td style={{ ...TD, textAlign: "right", color: s.ma50 == null ? "#999" : undefined }}>
                  {s.ma50 == null ? "N/A" : <>{s.ma50.toFixed(2)} {dirArrow(s.ma50_dir)}</>}
                </td>
                {/* MA150 */}
                <td style={{ ...TD, textAlign: "right", color: s.ma150 == null ? "#999" : undefined }}>
                  {s.ma150 == null ? "N/A" : <>{s.ma150.toFixed(2)} {dirArrow(s.ma150_dir)}</>}
                </td>
                {/* MA200 */}
                <td style={{ ...TD, textAlign: "right", color: s.ma200 == null ? "#999" : undefined }}>
                  {s.ma200 == null ? "N/A" : <>{s.ma200.toFixed(2)} {dirArrow(s.ma200_dir)}</>}
                </td>
                <td style={{ ...TD, textAlign: "right" }}>${s.high_52w?.toFixed(2)}</td>
                <td style={{ ...TD, textAlign: "right" }}>${s.low_52w?.toFixed(2)}</td>
                <td style={{ ...TD, textAlign: "right" }}>{s.days_from_high}</td>
                <td style={{ ...TD, textAlign: "right" }}>{s.days_from_low}</td>
                <td style={{ ...TD, textAlign: "right", color: "#c62828" }}>{s.pct_from_high?.toFixed(1)}%</td>
                <td style={{ ...TD, textAlign: "right", color: "#2e7d32" }}>{s.pct_from_low?.toFixed(1)}%</td>
                <td style={{ ...TD, textAlign: "right" }}>{s.beta?.toFixed(2)}</td>
                <td style={{ ...TD, textAlign: "right" }}>{s.composite_score?.toFixed(2)}</td>
                {/* MA diff columns */}
                {["ma200_vs_ma150", "ma200_vs_ma50", "ma150_vs_ma50"].map(k => {
                  const v = s[k];
                  return (
                    <td key={k} style={{ ...TD, textAlign: "right", color: maDiffColor(v) }}>
                      {v == null ? "N/A" : `${v > 0 ? "+" : ""}${v.toFixed(2)}%`}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
