import React, { useState, useEffect, useCallback } from "react";
import {
  freezePortfolio, fetchSnapshots, fetchDiff, confirmSells,
  addCashFlow, fetchCashFlows, deleteCashFlow, fetchPositions, fetchXirr,
} from "../services/api";

const btn = { padding: "6px 14px", cursor: "pointer", borderRadius: 4, border: "1px solid #ccc", background: "#fff", fontSize: 13 };
const btnPrimary = { ...btn, background: "#1976d2", color: "#fff", border: "none" };
const btnDanger = { ...btn, color: "#d32f2f", border: "1px solid #d32f2f" };
const card = { border: "1px solid #e0e0e0", borderRadius: 8, padding: 16, marginBottom: 16, background: "#fafafa" };
const subTab = (active) => ({ padding: "6px 16px", cursor: "pointer", border: "none", borderBottom: active ? "2px solid #1976d2" : "2px solid transparent", background: "none", fontWeight: active ? "bold" : "normal", fontSize: 13 });

const clr = (v) => (v > 0 ? "#2e7d32" : v < 0 ? "#c62828" : "#333");
const fmt = (v) => v != null ? v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—";

export default function PositionTracker({ user }) {
  const userId = user?.username || user?.userId;
  const [tab, setTab] = useState("freeze");

  return (
    <div>
      <h3 style={{ marginBottom: 8 }}>📈 Position Tracker</h3>
      <nav style={{ borderBottom: "1px solid #eee", marginBottom: 16 }}>
        <button style={subTab(tab === "freeze")} onClick={() => setTab("freeze")}>Freeze & Diff</button>
        <button style={subTab(tab === "cashflows")} onClick={() => setTab("cashflows")}>Cash Flows</button>
        <button style={subTab(tab === "positions")} onClick={() => setTab("positions")}>Positions</button>
        <button style={subTab(tab === "xirr")} onClick={() => setTab("xirr")}>XIRR</button>
      </nav>
      {tab === "freeze" && <FreezeSection userId={userId} />}
      {tab === "cashflows" && <CashFlowSection userId={userId} />}
      {tab === "positions" && <PositionsSection userId={userId} />}
      {tab === "xirr" && <XirrSection userId={userId} />}
    </div>
  );
}

// ==================== FREEZE & DIFF ====================
function FreezeSection({ userId }) {
  const [loading, setLoading] = useState(false);
  const [diffs, setDiffs] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [soldPrices, setSoldPrices] = useState({});
  const [confirming, setConfirming] = useState(false);
  const [initialDate, setInitialDate] = useState(new Date().toISOString().slice(0, 10));
  const [hasSnapshots, setHasSnapshots] = useState(false);

  const loadSnapshots = useCallback(async () => {
    const data = await fetchSnapshots(userId);
    setSnapshots(data);
    setHasSnapshots(data.length > 0);
  }, [userId]);

  useEffect(() => { loadSnapshots(); }, [loadSnapshots]);

  const handleFreeze = async () => {
    setLoading(true);
    try {
      const result = await freezePortfolio(userId, hasSnapshots ? null : initialDate);
      setDiffs(result.diffs || []);
      setSoldPrices({});
      loadSnapshots();
    } catch (e) { alert("Freeze failed: " + e.message); }
    setLoading(false);
  };

  const handleViewDiff = async () => {
    const result = await fetchDiff(userId);
    setDiffs(result.diffs || []);
    setSoldPrices({});
  };

  const handleConfirmSells = async (platform, sells) => {
    setConfirming(true);
    try {
      const payload = {
        platform,
        sells: sells.map((s) => ({
          symbol: s.symbol, stock_name: s.stock_name,
          quantity: s.type === "REMOVED" ? s.prev_qty : s.sold_qty,
          avg_buy_price: s.prev_avg,
          avg_sold_price: parseFloat(soldPrices[`${platform}_${s.symbol}`] || 0),
          currency: s.currency,
        })),
      };
      await confirmSells(userId, payload);
      alert("Sells recorded!");
      setDiffs(null);
    } catch (e) { alert("Failed: " + e.message); }
    setConfirming(false);
  };

  const typeColor = { ADDED: "#e8f5e9", REMOVED: "#ffebee", DECREASED: "#fff8e1", INCREASED: "#e3f2fd", UNCHANGED: "#f5f5f5" };
  const typeIcon = { ADDED: "🟢", REMOVED: "🔴", DECREASED: "🟡", INCREASED: "🔵", UNCHANGED: "⚪" };

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "flex-end" }}>
        {!hasSnapshots && (
          <label style={{ fontSize: 12 }}>Initial Investment Date<br />
            <input type="date" value={initialDate} onChange={(e) => setInitialDate(e.target.value)} style={{ padding: 4 }} />
          </label>
        )}
        <button style={btnPrimary} onClick={handleFreeze} disabled={loading}>
          {loading ? "Freezing..." : "🔒 Freeze Portfolio"}
        </button>
        <button style={btn} onClick={handleViewDiff}>View Current Diff</button>
      </div>

      {diffs && diffs.map((diff) => {
        const needsSell = diff.changes.filter((c) => c.needs_sold_price);
        return (
          <div key={diff.platform} style={card}>
            <h4 style={{ margin: "0 0 8px" }}>{diff.platform}</h4>
            <p style={{ fontSize: 12, color: "#666", margin: "0 0 8px" }}>
              Snapshot: {diff.snapshot_date || "just now"} | Previous: {diff.previous_snapshot_date || "none (first freeze)"}
              {diff.auto_deposit != null && <span style={{ color: "#1976d2", marginLeft: 8 }}>💰 Auto-deposit: {fmt(diff.auto_deposit)}</span>}
            </p>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ padding: 6, textAlign: "left" }}>Type</th>
                  <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
                  <th style={{ padding: 6, textAlign: "left" }}>Name</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Prev Qty</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Curr Qty</th>
                  <th style={{ padding: 6, textAlign: "right" }}>Avg Buy</th>
                  {needsSell.length > 0 && <th style={{ padding: 6, textAlign: "right" }}>Sold Price</th>}
                </tr>
              </thead>
              <tbody>
                {diff.changes.map((c) => (
                  <tr key={c.symbol} style={{ background: typeColor[c.type] || "#fff" }}>
                    <td style={{ padding: 6 }}>{typeIcon[c.type]} {c.type}</td>
                    <td style={{ padding: 6, fontWeight: "bold" }}>{c.symbol}</td>
                    <td style={{ padding: 6 }}>{c.stock_name}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{c.prev_qty != null ? c.prev_qty : c.qty ?? "—"}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{c.curr_qty != null ? c.curr_qty : c.qty ?? "—"}</td>
                    <td style={{ padding: 6, textAlign: "right" }}>{fmt(c.prev_avg || c.curr_avg || c.avg)}</td>
                    {needsSell.length > 0 && (
                      <td style={{ padding: 6, textAlign: "right" }}>
                        {c.needs_sold_price ? (
                          <input type="number" step="any" placeholder="sold price"
                            value={soldPrices[`${diff.platform}_${c.symbol}`] || ""}
                            onChange={(e) => setSoldPrices({ ...soldPrices, [`${diff.platform}_${c.symbol}`]: e.target.value })}
                            style={{ width: 90, padding: 3, textAlign: "right" }} />
                        ) : ""}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {needsSell.length > 0 && (
              <button style={{ ...btnPrimary, marginTop: 8 }} disabled={confirming}
                onClick={() => handleConfirmSells(diff.platform, needsSell)}>
                {confirming ? "Saving..." : `Confirm ${needsSell.length} Sell(s)`}
              </button>
            )}
          </div>
        );
      })}

      {snapshots.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h4>Snapshot History</h4>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead><tr style={{ background: "#f5f5f5" }}>
              <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
              <th style={{ padding: 6, textAlign: "left" }}>Date</th>
              <th style={{ padding: 6, textAlign: "right" }}>Stocks</th>
              <th style={{ padding: 6, textAlign: "right" }}>Total Invested</th>
            </tr></thead>
            <tbody>
              {snapshots.map((s) => (
                <tr key={s.platform_ts}>
                  <td style={{ padding: 6 }}>{s.platform}</td>
                  <td style={{ padding: 6 }}>{s.frozen_date?.slice(0, 19)}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{s.stock_count}</td>
                  <td style={{ padding: 6, textAlign: "right" }}>{fmt(s.total_invested)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ==================== CASH FLOWS ====================
function CashFlowSection({ userId }) {
  const [flows, setFlows] = useState([]);
  const [platform, setPlatform] = useState("");
  const [cfType, setCfType] = useState("DEPOSIT");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => { setFlows(await fetchCashFlows(userId)); }, [userId]);
  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!platform || !amount) return;
    await addCashFlow(userId, { platform, type: cfType, amount: parseFloat(amount), currency, date });
    setAmount("");
    load();
  };

  const handleDelete = async (sk) => {
    if (window.confirm("Delete this cash flow?")) { await deleteCashFlow(userId, sk); load(); }
  };

  return (
    <div>
      <div style={{ ...card, display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label style={{ fontSize: 12 }}>Platform<br />
          <input value={platform} onChange={(e) => setPlatform(e.target.value)} placeholder="e.g. prostocks" style={{ padding: 4, width: 120 }} />
        </label>
        <label style={{ fontSize: 12 }}>Type<br />
          <select value={cfType} onChange={(e) => setCfType(e.target.value)} style={{ padding: 4 }}>
            <option value="DEPOSIT">Deposit</option><option value="WITHDRAW">Withdraw</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Amount<br />
          <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ padding: 4, width: 100 }} />
        </label>
        <label style={{ fontSize: 12 }}>Currency<br />
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ padding: 4 }}>
            <option value="USD">USD</option><option value="INR">INR</option>
          </select>
        </label>
        <label style={{ fontSize: 12 }}>Date<br />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: 4 }} />
        </label>
        <button style={btnPrimary} onClick={handleAdd}>+ Add</button>
      </div>

      {flows.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#f5f5f5" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
            <th style={{ padding: 6, textAlign: "left" }}>Type</th>
            <th style={{ padding: 6, textAlign: "right" }}>Amount</th>
            <th style={{ padding: 6, textAlign: "left" }}>Currency</th>
            <th style={{ padding: 6, textAlign: "left" }}>Date</th>
            <th style={{ padding: 6 }}></th>
          </tr></thead>
          <tbody>
            {flows.map((f) => (
              <tr key={f.platform_ts_type}>
                <td style={{ padding: 6 }}>{f.platform}</td>
                <td style={{ padding: 6, color: f.type === "DEPOSIT" ? "#2e7d32" : "#c62828" }}>{f.type === "DEPOSIT" ? "⬇ Deposit" : "⬆ Withdraw"}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(f.amount)}</td>
                <td style={{ padding: 6 }}>{f.currency}</td>
                <td style={{ padding: 6 }}>{f.date}</td>
                <td style={{ padding: 6 }}><button style={btnDanger} onClick={() => handleDelete(f.platform_ts_type)}>Del</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {flows.length === 0 && <p style={{ color: "#999" }}>No cash flows recorded yet.</p>}
    </div>
  );
}

// ==================== POSITIONS ====================
function PositionsSection({ userId }) {
  const [data, setData] = useState({ open: [], closed: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setData(await fetchPositions(userId)); setLoading(false); })();
  }, [userId]);

  if (loading) return <p>Loading...</p>;

  return (
    <div>
      <h4>Open Positions ({data.open.length})</h4>
      {data.open.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, marginBottom: 20 }}>
          <thead><tr style={{ background: "#e8f5e9" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "right" }}>Qty</th>
            <th style={{ padding: 6, textAlign: "right" }}>Avg Buy</th>
            <th style={{ padding: 6, textAlign: "right" }}>Invested</th>
            <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
          </tr></thead>
          <tbody>
            {data.open.map((p) => (
              <tr key={p.stock_name}>
                <td style={{ padding: 6, fontWeight: "bold" }}>{p.symbol}</td>
                <td style={{ padding: 6 }}>{p.stock_name}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{p.quantity}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.avg_buy_price)}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.quantity * p.avg_buy_price)}</td>
                <td style={{ padding: 6 }}>{p.platform_name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{ color: "#999" }}>No open positions.</p>}

      <h4>Closed Positions ({data.closed.length})</h4>
      {data.closed.length > 0 ? (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead><tr style={{ background: "#ffebee" }}>
            <th style={{ padding: 6, textAlign: "left" }}>Symbol</th>
            <th style={{ padding: 6, textAlign: "left" }}>Name</th>
            <th style={{ padding: 6, textAlign: "right" }}>Qty</th>
            <th style={{ padding: 6, textAlign: "right" }}>Buy Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Sold Price</th>
            <th style={{ padding: 6, textAlign: "right" }}>Realized P/L</th>
            <th style={{ padding: 6, textAlign: "left" }}>Date</th>
            <th style={{ padding: 6, textAlign: "left" }}>Platform</th>
          </tr></thead>
          <tbody>
            {data.closed.map((p, i) => (
              <tr key={i}>
                <td style={{ padding: 6, fontWeight: "bold" }}>{p.symbol}</td>
                <td style={{ padding: 6 }}>{p.stock_name}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{p.quantity}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.avg_buy_price)}</td>
                <td style={{ padding: 6, textAlign: "right" }}>{fmt(p.avg_sold_price)}</td>
                <td style={{ padding: 6, textAlign: "right", color: clr(p.realized_pnl), fontWeight: "bold" }}>{fmt(p.realized_pnl)}</td>
                <td style={{ padding: 6 }}>{p.date}</td>
                <td style={{ padding: 6 }}>{p.platform}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p style={{ color: "#999" }}>No closed positions yet.</p>}
    </div>
  );
}

// ==================== XIRR ====================
function XirrSection({ userId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => { setData(await fetchXirr(userId)); setLoading(false); })();
  }, [userId]);

  if (loading) return <p>Calculating XIRR (fetching live prices)...</p>;
  if (!data) return <p>Failed to load XIRR.</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        {data.platforms.map((p) => (
          <div key={p.platform} style={{ ...card, minWidth: 200, flex: 1 }}>
            <h4 style={{ margin: "0 0 8px", textTransform: "capitalize" }}>{p.platform}</h4>
            <div style={{ fontSize: 28, fontWeight: "bold", color: clr(p.xirr) }}>{p.xirr_pct}</div>
            <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>
              Deposited: {fmt(p.total_deposited)}<br />
              Withdrawn: {fmt(p.total_withdrawn)}<br />
              Current Value: {fmt(p.current_value)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ ...card, background: "#e3f2fd" }}>
        <h4 style={{ margin: "0 0 8px" }}>Overall</h4>
        <div style={{ fontSize: 32, fontWeight: "bold", color: clr(data.overall.xirr) }}>{data.overall.xirr_pct}</div>
        <div style={{ fontSize: 13, color: "#666", marginTop: 8 }}>
          Total Deposited: {fmt(data.overall.total_deposited)} | Current Value: {fmt(data.overall.current_value)}
        </div>
      </div>

      {data.platforms.length === 0 && (
        <p style={{ color: "#999" }}>No cash flows recorded. Add deposits/withdrawals in the Cash Flows tab to calculate XIRR.</p>
      )}
    </div>
  );
}
