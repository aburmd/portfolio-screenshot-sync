import React, { useState, useMemo, useEffect, useCallback } from "react";

const tableStyle = { width: "100%", borderCollapse: "collapse", marginTop: 12, fontSize: 13 };
const tdStyle = { padding: "6px 8px", borderBottom: "1px solid #eee" };
const inputStyle = { width: 70, padding: 3, border: "1px solid #ccc", borderRadius: 3 };
const btnStyle = { padding: "2px 8px", marginRight: 3, cursor: "pointer", fontSize: 11 };

const fmt = (v) => v != null ? v.toFixed(2) : "—";
const pctFmt = (v) => v != null ? v.toFixed(2) + "%" : "—";
const clr = (v) => v > 0 ? "#2e7d32" : v < 0 ? "#c62828" : "#666";

const DEFAULT_COLUMNS = [
  { key: "serial", label: "#", sortable: false },
  { key: "symbol", label: "Symbol", sortable: true },
  { key: "stock_name", label: "Stock Name", sortable: true },
  { key: "quantity", label: "Qty", sortable: true },
  { key: "avg_buy_price", label: "Avg Buy", sortable: true },
  { key: "curPrice", label: "Cur Price", sortable: true },
  { key: "invested", label: "Invested", sortable: true },
  { key: "currentAmt", label: "Current", sortable: true },
  { key: "pnl", label: "P/L", sortable: true },
  { key: "pnlPct", label: "P/L %", sortable: true },
  { key: "invPct", label: "Inv %", sortable: true },
  { key: "curPct", label: "Cur %", sortable: true },
  { key: "platform_name", label: "Platform", sortable: true },
];

const STORAGE_KEY = "portfolio_column_order";

function PortfolioTable({ data, prices, loading, onDelete, onBulkDelete, onUpdate, onAdd, readOnly, displayCurrency, exchangeRate }) {
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
  const [columns, setColumns] = useState(DEFAULT_COLUMNS);
  const [dragIdx, setDragIdx] = useState(null);
  const [selected, setSelected] = useState(new Set());

  // Load column order from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const order = JSON.parse(saved);
        const reordered = order.map((key) => DEFAULT_COLUMNS.find((c) => c.key === key)).filter(Boolean);
        // Add any new columns not in saved order
        DEFAULT_COLUMNS.forEach((c) => { if (!reordered.find((r) => r.key === c.key)) reordered.push(c); });
        setColumns(reordered);
      }
    } catch {}
  }, []);

  const saveColumnOrder = useCallback((cols) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cols.map((c) => c.key)));
  }, []);

  // Drag and drop handlers
  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (targetIdx) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const newCols = [...columns];
    const [moved] = newCols.splice(dragIdx, 1);
    newCols.splice(targetIdx, 0, moved);
    setColumns(newCols);
    saveColumnOrder(newCols);
    setDragIdx(null);
  };

  // Calculate derived values with currency conversion for "All" tab
  const rows = (data || []).map((row) => {
    const qty = row.quantity || 0;
    const avg = row.avg_buy_price || 0;
    const rowCurrency = row.currency || "USD";
    const curPrice = row.current_price || prices[row.symbol] || null;
    const invested = qty * avg;
    const currentAmt = curPrice != null ? qty * curPrice : null;
    const pnl = currentAmt != null ? currentAmt - invested : null;
    const pnlPct = invested > 0 && pnl != null ? (pnl / invested) * 100 : null;

    // Currency conversion for display
    let convRate = 1;
    let dispSymbol = rowCurrency === "INR" ? "₹" : "$";
    if (displayCurrency && displayCurrency !== "default" && exchangeRate && rowCurrency !== displayCurrency) {
      if (rowCurrency === "INR" && displayCurrency === "USD") convRate = 1 / exchangeRate;
      else if (rowCurrency === "USD" && displayCurrency === "INR") convRate = exchangeRate;
      dispSymbol = displayCurrency === "INR" ? "₹" : "$";
    }
    // If displayCurrency is set (not default), force the symbol
    if (displayCurrency && displayCurrency !== "default") {
      dispSymbol = displayCurrency === "INR" ? "₹" : "$";
    }

    return { ...row, curPrice, invested, currentAmt, pnl, pnlPct, convRate, dispSymbol, rowCurrency };
  });

  const totalInvested = rows.reduce((s, r) => s + r.invested * r.convRate, 0);
  const totalCurrent = rows.reduce((s, r) => s + (r.currentAmt || 0) * r.convRate, 0);
  const totalPnl = totalCurrent - totalInvested;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const handleSort = (key) => {
    if (sortCol === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir("asc"); }
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

  const toggleSelect = (sn) => {
    const next = new Set(selected);
    next.has(sn) ? next.delete(sn) : next.add(sn);
    setSelected(next);
  };
  const toggleSelectAll = () => {
    if (selected.size === sortedRows.length) setSelected(new Set());
    else setSelected(new Set(sortedRows.map((r) => r.stock_name)));
  };
  const handleDeleteSelected = () => {
    if (selected.size === 0) return;
    if (window.confirm(`Delete ${selected.size} selected stock(s)?`)) {
      onBulkDelete([...selected]);
      setSelected(new Set());
    }
  };
  const handleDeleteAll = () => {
    if (sortedRows.length === 0) return;
    if (window.confirm(`Delete ALL ${sortedRows.length} stocks from portfolio?`)) {
      onBulkDelete(sortedRows.map((r) => r.stock_name));
      setSelected(new Set());
    }
  };

  const startEdit = (row) => {
    setEditingRow(row.stock_name); setEditQty(String(row.quantity));
    setEditAvg(String(row.avg_buy_price)); setEditCurPrice(row.curPrice != null ? String(row.curPrice) : "");
  };
  const cancelEdit = () => setEditingRow(null);
  const saveEdit = (sn) => { onUpdate(sn, parseFloat(editQty), parseFloat(editAvg), editCurPrice.trim() ? parseFloat(editCurPrice) : null); setEditingRow(null); };
  const handleDelete = (sn) => { if (window.confirm(`Delete "${sn}"?`)) onDelete(sn); };
  const handleAdd = () => { if (!newName.trim() || !newQty || !newAvg) return; onAdd(newName.trim(), parseFloat(newQty), parseFloat(newAvg)); setAdding(false); setNewName(""); setNewQty(""); setNewAvg(""); };

  const sortArrow = (key) => sortCol !== key ? " ↕" : sortDir === "asc" ? " ↑" : " ↓";

  const renderCell = (col, row, idx) => {
    const isEditing = editingRow === row.stock_name;
    const invPct = totalInvested > 0 ? (row.invested / totalInvested) * 100 : 0;
    const curPct = totalCurrent > 0 && row.currentAmt != null ? (row.currentAmt / totalCurrent) * 100 : null;

    switch (col.key) {
      case "serial": return idx + 1;
      case "symbol": return <><strong>{row.symbol}</strong>{row.symbol === "UNKNOWN" && <span style={{ color: "red", marginLeft: 2 }}>⚠</span>}</>;
      case "stock_name": return row.stock_name;
      case "quantity": return isEditing ? <input type="number" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} style={inputStyle} /> : row.quantity;
      case "avg_buy_price": return isEditing ? <input type="number" step="any" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} style={inputStyle} /> : `${row.dispSymbol}${fmt(row.avg_buy_price * row.convRate)}`;
      case "curPrice": return isEditing ? <input type="number" step="any" value={editCurPrice} onChange={(e) => setEditCurPrice(e.target.value)} placeholder="auto" style={inputStyle} /> : <span>{row.curPrice != null ? `${row.dispSymbol}${fmt(row.curPrice * row.convRate)}` : "—"}{row.current_price != null && <span style={{ color: "#f57c00", marginLeft: 2, fontSize: 10 }}>✎</span>}</span>;
      case "invested": return `${row.dispSymbol}${fmt(row.invested * row.convRate)}`;
      case "currentAmt": return row.currentAmt != null ? `${row.dispSymbol}${fmt(row.currentAmt * row.convRate)}` : "—";
      case "pnl": return <span style={{ color: clr(row.pnl), fontWeight: "bold" }}>{row.pnl != null ? `${row.dispSymbol}${fmt(row.pnl * row.convRate)}` : "—"}</span>;
      case "pnlPct": return <span style={{ color: clr(row.pnlPct) }}>{pctFmt(row.pnlPct)}</span>;
      case "invPct": return pctFmt(invPct);
      case "curPct": return curPct != null ? pctFmt(curPct) : "—";
      case "platform_name": return row.platform_name;
      default: return "";
    }
  };

  // Determine total display symbol based on displayCurrency or majority currency
  const totalDispSymbol = (() => {
    if (displayCurrency === "INR") return "₹";
    if (displayCurrency === "USD") return "$";
    // Default mode: if all rows are same currency, use that; otherwise $
    const currencies = [...new Set(rows.map((r) => r.rowCurrency))];
    if (currencies.length === 1) return currencies[0] === "INR" ? "₹" : "$";
    return "$";
  })();

  const renderTotalCell = (col) => {
    switch (col.key) {
      case "invested": return `${totalDispSymbol}${fmt(totalInvested)}`;
      case "currentAmt": return `${totalDispSymbol}${fmt(totalCurrent)}`;
      case "pnl": return <span style={{ color: clr(totalPnl) }}>{totalDispSymbol}{fmt(totalPnl)}</span>;
      case "pnlPct": return <span style={{ color: clr(totalPnlPct) }}>{pctFmt(totalPnlPct)}</span>;
      case "invPct": return "100%";
      case "curPct": return "100%";
      case "serial": return "";
      default: return "";
    }
  };

  const thStyle = (isDragging) => ({
    textAlign: "left", padding: "6px 8px", borderBottom: "2px solid #ddd",
    background: isDragging ? "#e3f2fd" : "#f5f5f5", whiteSpace: "nowrap",
    cursor: "grab", userSelect: "none",
  });

  const totalColSpan = columns.filter((c) => !["invested", "currentAmt", "pnl", "pnlPct", "invPct", "curPct", "serial"].includes(c.key)).length;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: "#999" }}>💡 Drag column headers to reorder</span>
        {!readOnly && selected.size > 0 && (
          <button style={{ ...btnStyle, border: "1px solid #d32f2f", color: "#d32f2f", padding: "4px 12px" }} onClick={handleDeleteSelected}>
            🗑 Delete Selected ({selected.size})
          </button>
        )}
        {!readOnly && sortedRows.length > 0 && selected.size === 0 && (
          <button style={{ ...btnStyle, border: "1px solid #999", color: "#999", padding: "4px 12px" }} onClick={handleDeleteAll}>
            Delete All
          </button>
        )}
      </div>
      <table style={tableStyle}>
        <thead>
          <tr>
            {!readOnly && (
              <th style={{ ...thStyle(false), cursor: "pointer", width: 30 }} onClick={toggleSelectAll}>
                <input type="checkbox" checked={sortedRows.length > 0 && selected.size === sortedRows.length} onChange={toggleSelectAll} />
              </th>
            )}
            {columns.map((col, i) => (
              <th key={col.key} style={thStyle(dragIdx === i)}
                draggable onDragStart={() => handleDragStart(i)}
                onDragOver={handleDragOver} onDrop={() => handleDrop(i)}
                onClick={() => col.sortable && handleSort(col.key)}>
                {col.label}{col.sortable && <span style={{ fontSize: 10, color: "#999" }}>{sortArrow(col.key)}</span>}
              </th>
            ))}
            {!readOnly && <th style={{ ...thStyle(false), cursor: "default" }}>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => (
            <tr key={row.stock_name} style={selected.has(row.stock_name) ? { background: "#fff3e0" } : {}}>
              {!readOnly && (
                <td style={tdStyle}>
                  <input type="checkbox" checked={selected.has(row.stock_name)} onChange={() => toggleSelect(row.stock_name)} />
                </td>
              )}
              {columns.map((col) => (
                <td key={col.key} style={tdStyle}>{renderCell(col, row, idx)}</td>
              ))}
              {!readOnly && (
                <td style={tdStyle}>
                  {editingRow === row.stock_name ? (
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
          ))}

          {rows.length > 0 && (
            <tr style={{ background: "#f5f5f5", fontWeight: "bold" }}>
              {!readOnly && <td style={tdStyle}></td>}
              {columns.map((col, i) => {
                const val = renderTotalCell(col);
                if (col.key === "symbol") return <td key={col.key} style={tdStyle}>TOTAL</td>;
                return <td key={col.key} style={tdStyle}>{val}</td>;
              })}
              {!readOnly && <td style={tdStyle}></td>}
            </tr>
          )}

          {!readOnly && (adding ? (
            <tr style={{ background: "#e8f5e9" }}>
              <td style={tdStyle}></td>
              {columns.map((col) => {
                if (col.key === "serial") return <td key={col.key} style={tdStyle}>—</td>;
                if (col.key === "stock_name") return <td key={col.key} style={tdStyle}><input type="text" placeholder="Stock name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: 140 }} /></td>;
                if (col.key === "quantity") return <td key={col.key} style={tdStyle}><input type="number" step="any" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} style={inputStyle} /></td>;
                if (col.key === "avg_buy_price") return <td key={col.key} style={tdStyle}><input type="number" step="any" placeholder="Avg" value={newAvg} onChange={(e) => setNewAvg(e.target.value)} style={inputStyle} /></td>;
                if (col.key === "symbol") return <td key={col.key} style={tdStyle}>
                  <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={handleAdd} disabled={!newName.trim() || !newQty || !newAvg}>Save</button>
                  <button style={{ ...btnStyle, border: "1px solid #ccc" }} onClick={() => setAdding(false)}>✕</button>
                </td>;
                return <td key={col.key} style={tdStyle}></td>;
              })}
              {!readOnly && <td style={tdStyle}></td>}
            </tr>
          ) : (
            <tr>
              <td colSpan={columns.length + (readOnly ? 0 : 2)} style={{ ...tdStyle, textAlign: "center" }}>
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
