import React, { useState } from "react";

const tableStyle = { width: "100%", borderCollapse: "collapse", marginTop: 12 };
const thStyle = { textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #ddd", background: "#f5f5f5" };
const tdStyle = { padding: "8px 12px", borderBottom: "1px solid #eee" };
const inputStyle = { width: 80, padding: 3, border: "1px solid #ccc", borderRadius: 3 };
const btnStyle = { padding: "3px 10px", marginRight: 4, cursor: "pointer", fontSize: 12 };

function PortfolioTable({ data, loading, onDelete, onUpdate }) {
  const [editingRow, setEditingRow] = useState(null);
  const [editQty, setEditQty] = useState("");
  const [editAvg, setEditAvg] = useState("");

  if (loading) return <p>Loading...</p>;
  if (!data || data.length === 0) return <p style={{ color: "#999" }}>No stocks yet. Upload a screenshot to get started.</p>;

  const startEdit = (row) => {
    setEditingRow(row.stock_name);
    setEditQty(String(row.quantity));
    setEditAvg(String(row.avg_buy_price));
  };

  const cancelEdit = () => {
    setEditingRow(null);
    setEditQty("");
    setEditAvg("");
  };

  const saveEdit = (stockName) => {
    onUpdate(stockName, parseFloat(editQty), parseFloat(editAvg));
    setEditingRow(null);
  };

  const handleDelete = (stockName) => {
    if (window.confirm(`Delete "${stockName}" from portfolio?`)) {
      onDelete(stockName);
    }
  };

  return (
    <table style={tableStyle}>
      <thead>
        <tr>
          <th style={thStyle}>Symbol</th>
          <th style={thStyle}>Stock Name</th>
          <th style={thStyle}>Qty</th>
          <th style={thStyle}>Avg Buy Price</th>
          <th style={thStyle}>Platform</th>
          <th style={thStyle}>Updated</th>
          <th style={thStyle}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          const isEditing = editingRow === row.stock_name;
          return (
            <tr key={row.stock_name}>
              <td style={tdStyle}>
                <strong>{row.symbol}</strong>
                {row.symbol === "UNKNOWN" && <span style={{ color: "red", marginLeft: 4 }}>⚠</span>}
              </td>
              <td style={tdStyle}>{row.stock_name}</td>
              <td style={tdStyle}>
                {isEditing ? (
                  <input type="number" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} style={inputStyle} />
                ) : row.quantity}
              </td>
              <td style={tdStyle}>
                {isEditing ? (
                  <input type="number" step="any" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} style={inputStyle} />
                ) : `$${row.avg_buy_price}`}
              </td>
              <td style={tdStyle}>{row.platform_name}</td>
              <td style={tdStyle}>{row.uploaded_date?.split("T")[0]}</td>
              <td style={tdStyle}>
                {isEditing ? (
                  <>
                    <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={() => saveEdit(row.stock_name)}>Save</button>
                    <button style={{ ...btnStyle, border: "1px solid #ccc" }} onClick={cancelEdit}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button style={{ ...btnStyle, border: "1px solid #1976d2", color: "#1976d2" }} onClick={() => startEdit(row)}>Edit</button>
                    <button style={{ ...btnStyle, border: "1px solid #d32f2f", color: "#d32f2f" }} onClick={() => handleDelete(row.stock_name)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default PortfolioTable;
