import React, { useState, useEffect, useMemo } from "react";
import { fetchDailyScreener } from "../services/api";

const MA_FILTERS = [
  { key: "ma200", label: "200 MA" },
  { key: "ma150", label: "150 MA" },
  { key: "ma50",  label: "50 MA"  },
];

const COLUMNS = [
  { key: "rank",           label: "Rank" },
  { key: "symbol",         label: "Symbol" },
  { key: "price",          label: "Price" },
  { key: "ma50",           label: "MA50" },
  { key: "ma150",          label: "MA150" },
  { key: "ma200",          label: "MA200" },
  { key: "high_52w",       label: "52W High" },
  { key: "low_52w",        label: "52W Low" },
  { key: "days_from_high", label: "Days↓High" },
  { key: "days_from_low",  label: "Days↑Low" },
  { key: "pct_from_high",  label: "% from High" },
  { key: "pct_from_low",   label: "% from Low" },
  { key: "beta",           label: "Beta" },
  { key: "composite_score",label: "Score" },
];

function dirArrow(dir) {
  if (dir === "up")   return <span style={{ color: "#2e7d32" }}>▲</span>;
  if (dir === "down") return <span style={{ color: "#c62828" }}>▼</span>;
  return <span style={{ color: "#999" }}>—</span>;
}

function maCell(val, dir) {
  if (val == null) return <td style={{ color: "#999" }}>N/A</td>;
  return <td>{val.toFixed(2)} {dirArrow(dir)}</td>;
}

export default function Screener() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [filters, setFilters] = useState({ ma200: null, ma150: null, ma50: null }); // null | "up" | "down"
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
      const av = a[key] ?? (typeof a[key] === "number" ? Infinity : "");
      const bv = b[key] ?? (typeof b[key] === "number" ? Infinity : "");
      if (av < bv) return dir === "asc" ? -1 : 1;
      if (av > bv) return dir === "asc" ?  1 : -1;
      return 0;
    });
  }, [filtered, sort]);

  if (loading) return <div style={{ padding: 24 }}>Loading screener…</div>;
  if (error)   return <div style={{ padding: 24, color: "red" }}>Error: {error}</div>;

  return (
    <div style={{ padding: 16 }}>
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
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              {COLUMNS.map(({ key, label }) => (
                <th key={key} onClick={() => handleSort(key)} style={{
                  padding: "6px 10px", border: "1px solid #ddd", cursor: "pointer",
                  whiteSpace: "nowrap", userSelect: "none",
                  color: sort.key === key ? "#1976d2" : "#333",
                }}>
                  {label} {sort.key === key ? (sort.dir === "asc" ? "↑" : "↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map(s => (
              <tr key={s.symbol} style={{ borderBottom: "1px solid #eee" }}>
                <td style={{ padding: "5px 10px", textAlign: "center" }}>{s.rank}</td>
                <td style={{ padding: "5px 10px", fontWeight: "bold" }}>{s.symbol}</td>
                <td style={{ padding: "5px 10px", textAlign: "right" }}>${s.price?.toFixed(2)}</td>
                {maCell(s.ma50,  s.ma50_dir)}
                {maCell(s.ma150, s.ma150_dir)}
                {maCell(s.ma200, s.ma200_dir)}
                <td style={{ padding: "5px 10px", textAlign: "right" }}>${s.high_52w?.toFixed(2)}</td>
                <td style={{ padding: "5px 10px", textAlign: "right" }}>${s.low_52w?.toFixed(2)}</td>
                <td style={{ padding: "5px 10px", textAlign: "right" }}>{s.days_from_high}</td>
                <td style={{ padding: "5px 10px", textAlign: "right" }}>{s.days_from_low}</td>
                <td style={{ padding: "5px 10px", textAlign: "right", color: "#c62828" }}>{s.pct_from_high?.toFixed(1)}%</td>
                <td style={{ padding: "5px 10px", textAlign: "right", color: "#2e7d32" }}>{s.pct_from_low?.toFixed(1)}%</td>
                <td style={{ padding: "5px 10px", textAlign: "right" }}>{s.beta?.toFixed(2)}</td>
                <td style={{ padding: "5px 10px", textAlign: "right" }}>{s.composite_score?.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
