import React, { useState, useMemo } from "react";

const tableStyle = { width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 };
const thBase = { textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #ddd", background: "#f5f5f5", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" };
const tdStyle = { padding: "6px 8px", borderBottom: "1px solid #eee" };
const inputStyle = { width: 70, padding: 3, border: "1px solid #ccc", borderRadius: 3 };
const btnStyle = { padding: "2px 8px", marginRight: 3, cursor: "pointer", fontSize: 11 };

const fmt = (v) => v != null ? v.toFixed(2) : "—";
const pct = (v) => v != null ? v.toFixed(2) + "%" : "—";
const clr = (v) => v > 0 ? "#2e7d32" : v < 0 ? "#c62828" : "#666";

function PortfolioTable({ data, prices, loading, onDelete, onUpdate, onAdd, readOnly }) {
  const [editingRow, setEditingRow] = useState(null);
  const [editQty, setEditQty] = useState("");
  const [editAvg, setEditAvg] = useState("");
  const [editCurPrice, setEditCurPrice] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newAvg, setNewAvg] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  // Calculate derived values — DDB current_price overrides Yahoo price
  const rows = (data || []).map((row) => {
    const qty = row.quantity || 0;
    const avg = row.avg_buy_price || 0;
    const curPrice = row.current_price || prices[row.symbol] || null;
    const invested = qty * avg;
    const currentAmt = curPrice != null ? qty * curPrice : null;
    const pnl = currentAmt != null ? currentAmt - invested : null;
    const pnlPct = invested > 0 && pnl != null ? (pnl / invested) * 100 : null;
    return { ...row, curPrice, invested, currentAmt, pnl, pnlPct };
  });

  const totalInvested = rows.reduce((s, r) => s + r.invested, 0);
  const totalCurrent = rows.reduce((s, r) => s + (r.currentAmt || 0), 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  // Sorting
  const columns = [
    { key: "symbol", label: "Symbol" },
    { key: "stock_name", label: "Stock Name" },
    { key: "quantity", label: "Qty" },
    { key: "avg_buy_price", label: "Avg Buy" },
    { key: "curPrice", label: "Cur Price" },
    { key: "invested", label: "Invested" },
    { key: "currentAmt", label: "Current" },
    { key: "pnl", label: "P/L" },
    { key: "pnlPct", label: "P/L %" },
    { key: "invPct", label: "Inv %" },
    { key: "curPct", label: "Cur %" },
    { key: "platform_name", label: "Platform" },
  ];

  const handleSort = (key) => {
    if (sortCol === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortCol(key);
      setSortDir("asc");
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortCol) return rows;
    const sorted = [...rows];
    sorted.forEach((r) => {
      r.invPct = totalInvested > 0 ? (r.invested / totalInvested) * 100 : 0;
      r.curPct = totalCurrent > 0 && r.currentAmt != null ? (r.currentAmt / totalCurrent) * 100 : null;
    });
    sorted.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (va == null) va = sortDir === "asc" ? Infinity : -Infinity;
      if (vb == null) vb = sortDir === "asc" ? Infinity : -Infinity;
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return sorted;
  }, [rows, sortCol, sortDir, totalInvested, totalCurrent]);

  if (loading) return <p>Loading...</p>;

  const startEdit = (row) => {
    setEditingRow(row.stock_name);
    setEditQty(String(row.quantity));
    setEditAvg(String(row.avg_buy_price));
    setEditCurPrice(row.curPrice != null ? String(row.curPrice) : "");
  };
  const cancelEdit = () => setEditingRow(null);
  const saveEdit = (stockName) => {
    const cp = editCurPrice.trim() ? parseFloat(editCurPrice) : null;
    onUpdate(stockName, parseFloat(editQty), parseFloat(editAvg), cp);
    setEditingRow(null);
  };
  const handleDelete = (stockName) => { if (window.confirm(`Delete "${stockName}"?`)) onDelete(stockName); };
  const handleAdd = () => {
    if (!newName.trim() || !newQty || !newAvg) return;
    onAdd(newName.trim(), parseFloat(newQty), parseFloat(newAvg));
    setAdding(false); setNewName(""); setNewQty(""); setNewAvg("");
  };

  const sortArrow = (key) => {
    if (sortCol !== key) return " ↕";
    return sortDir === "asc" ? " ↑" : " ↓";
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={tableStyle}>
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key} style={thBase} onClick={() => handleSort(col.key)}>
                {col.label}<span style={{ fontSize: 10, color: "#999" }}>{sortArrow(col.key)}</span>
              </th>
            ))}
            {!readOnly && <th style={{ ...thBase, cursor: "default" }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const isEditing = editingRow === row.stock_name;
            const invPct = totalInvested > 0 ? (row.invested / totalInvested) * 100 : 0;
            const curPct = totalCurrent > 0 && row.currentAmt != null ? (row.currentAmt / totalCurrent) * 100 : null;
            return (
              <tr key={row.stock_name}>
                <td style={tdStyle}>
                  <strong>{row.symbol}</strong>
                  {row.symbol === "UNKNOWN" && <span style={{ color: "red", marginLeft: 2 }}>⚠</span>}
                </td>
                <td style={tdStyle}>{row.stock_name}</td>
                <td style={tdStyle}>
                  {isEditing ? <input type="number" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} style={inputStyle} /> : row.quantity}
                </td>
                <td style={tdStyle}>
                  {isEditing ? <input type="number" step="any" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} style={inputStyle} /> : `$${fmt(row.avg_buy_price)}`}
                </td>
                <td style={tdStyle}>
                  {isEditing ? (
                    <input type="number" step="any" value={editCurPrice} onChange={(e) => setEditCurPrice(e.target.value)}
                      placeholder="auto" style={inputStyle} />
                  ) : (
                    <span>
                      {row.curPrice != null ? `$${fmt(row.curPrice)}` : "—"}
                      {row.current_price != null && <span style={{ color: "#f57c00", marginLeft: 2, fontSize: 10 }}>✎</span>}
                    </span>
                  )}
                </td>
                <td style={tdStyle}>${fmt(row.invested)}</td>
                <td style={tdStyle}>{row.currentAmt != null ? `$${fmt(row.currentAmt)}` : "—"}</td>
                <td style={{ ...tdStyle, color: clr(row.pnl), fontWeight: "bold" }}>{row.pnl != null ? `$${fmt(row.pnl)}` : "—"}</td>
                <td style={{ ...tdStyle, color: clr(row.pnlPct) }}>{pct(row.pnlPct)}</td>
                <td style={tdStyle}>{pct(invPct)}</td>
                <td style={tdStyle}>{curPct != null ? pct(curPct) : "—"}</td>
                <td style={tdStyle}>{row.platform_name}</td>
                {!readOnly && (
                <td style={tdStyle}>
                  {isEditing ? (
                    <>
                      <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={() => saveEdit(row.stock_name)}>Save</button>
                      <button style={{ ...btnStyle, border: "1px solid #ccc" }} onClick={cancelEdit}>✕</button>
                    </>
                  ) : (
                    <>
                      <button style={{ ...btnStyle, border: "1px solid #1976d2", color: "#1976d2" }} onClick={() => startEdit(row)}>Edit</button>
                      <button style={{ ...btnStyle, border: "1px solid #d32f2f", color: "#d32f2f" }} onClick={() => handleDelete(row.stock_name)}>Del</button>
                    </>
                  )}
                </td>
                )}
              </tr>
            );
          })}

          {/* Summary row */}
          {rows.length > 0 && (
            <tr style={{ background: "#f5f5f5", fontWeight: "bold" }}>
              <td style={tdStyle} colSpan={5}>TOTAL</td>
              <td style={tdStyle}>${fmt(totalInvested)}</td>
              <td style={tdStyle}>${fmt(totalCurrent)}</td>
              <td style={{ ...tdStyle, color: clr(totalPnl) }}>${fmt(totalPnl)}</td>
              <td style={{ ...tdStyle, color: clr(totalPnlPct) }}>{pct(totalPnlPct)}</td>
              <td style={tdStyle}>100%</td>
              <td style={tdStyle}>100%</td>
              {!readOnly && <td style={tdStyle} colSpan={2}></td>}
            </tr>
          )}

          {/* Add row */}
          {!readOnly && (adding ? (
            <tr style={{ background: "#e8f5e9" }}>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}><input type="text" placeholder="Stock name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: 140 }} /></td>
              <td style={tdStyle}><input type="number" step="any" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} style={inputStyle} /></td>
              <td style={tdStyle}><input type="number" step="any" placeholder="Avg" value={newAvg} onChange={(e) => setNewAvg(e.target.value)} style={inputStyle} /></td>
              <td style={tdStyle} colSpan={8}>
                <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={handleAdd} disabled={!newName.trim() || !newQty || !newAvg}>Save</button>
                <button style={{ ...btnStyle, border: "1px solid #ccc" }} onClick={() => setAdding(false)}>Cancel</button>
              </td>
              <td style={tdStyle}></td>
            </tr>
          ) : (
            <tr>
              <td colSpan={13} style={{ ...tdStyle, textAlign: "center" }}>
                <button style={{ ...btnStyle, border: "1px solid #4CAF50", color: "#4CAF50", padding: "5px 14px" }} onClick={() => setAdding(true)}>+ Add Stock Manually</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default PortfolioTable;
