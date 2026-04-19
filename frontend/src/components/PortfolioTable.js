import React, { useState } from "react";

const tableStyle = { width: "100%", borderCollapse: "collapse", marginTop: 12 };
const thStyle = { textAlign: "left", padding: "8px 12px", borderBottom: "2px solid #ddd", background: "#f5f5f5" };
const tdStyle = { padding: "8px 12px", borderBottom: "1px solid #eee" };
const inputStyle = { width: 80, padding: 3, border: "1px solid #ccc", borderRadius: 3 };
const btnStyle = { padding: "3px 10px", marginRight: 4, cursor: "pointer", fontSize: 12 };

function PortfolioTable({ data, loading, onDelete, onUpdate, onAdd }) {
  const [editingRow, setEditingRow] = useState(null);
  const [editQty, setEditQty] = useState("");
  const [editAvg, setEditAvg] = useState("");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newAvg, setNewAvg] = useState("");

  if (loading) return <p>Loading...</p>;
  if (!data || data.length === 0) {
    return (
      <div>
        <p style={{ color: "#999" }}>No stocks yet. Upload a screenshot or add manually.</p>
        <AddRow adding={adding} setAdding={setAdding} newName={newName} setNewName={setNewName}
          newQty={newQty} setNewQty={setNewQty} newAvg={newAvg} setNewAvg={setNewAvg} onAdd={onAdd}
          onReset={() => { setAdding(false); setNewName(""); setNewQty(""); setNewAvg(""); }} />
      </div>
    );
  }

  const startEdit = (row) => {
    setEditingRow(row.stock_name);
    setEditQty(String(row.quantity));
    setEditAvg(String(row.avg_buy_price));
  };

  const cancelEdit = () => { setEditingRow(null); };

  const saveEdit = (stockName) => {
    onUpdate(stockName, parseFloat(editQty), parseFloat(editAvg));
    setEditingRow(null);
  };

  const handleDelete = (stockName) => {
    if (window.confirm(`Delete "${stockName}" from portfolio?`)) onDelete(stockName);
  };

  const handleAdd = () => {
    if (!newName.trim() || !newQty || !newAvg) return;
    onAdd(newName.trim(), parseFloat(newQty), parseFloat(newAvg));
    setAdding(false); setNewName(""); setNewQty(""); setNewAvg("");
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
                {isEditing ? <input type="number" step="any" value={editQty} onChange={(e) => setEditQty(e.target.value)} style={inputStyle} /> : row.quantity}
              </td>
              <td style={tdStyle}>
                {isEditing ? <input type="number" step="any" value={editAvg} onChange={(e) => setEditAvg(e.target.value)} style={inputStyle} /> : `$${row.avg_buy_price}`}
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
        {adding ? (
          <tr style={{ background: "#e8f5e9" }}>
            <td style={tdStyle}>—</td>
            <td style={tdStyle}><input type="text" placeholder="Stock name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: 160 }} /></td>
            <td style={tdStyle}><input type="number" step="any" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} style={inputStyle} /></td>
            <td style={tdStyle}><input type="number" step="any" placeholder="Avg price" value={newAvg} onChange={(e) => setNewAvg(e.target.value)} style={inputStyle} /></td>
            <td style={tdStyle}>manual</td>
            <td style={tdStyle}>—</td>
            <td style={tdStyle}>
              <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={handleAdd} disabled={!newName.trim() || !newQty || !newAvg}>Save</button>
              <button style={{ ...btnStyle, border: "1px solid #ccc" }} onClick={() => setAdding(false)}>Cancel</button>
            </td>
          </tr>
        ) : (
          <tr>
            <td colSpan={7} style={{ ...tdStyle, textAlign: "center" }}>
              <button style={{ ...btnStyle, border: "1px solid #4CAF50", color: "#4CAF50", padding: "6px 16px" }} onClick={() => setAdding(true)}>+ Add Stock Manually</button>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function AddRow({ adding, setAdding, newName, setNewName, newQty, setNewQty, newAvg, setNewAvg, onAdd, onReset }) {
  const handleAdd = () => {
    if (!newName.trim() || !newQty || !newAvg) return;
    onAdd(newName.trim(), parseFloat(newQty), parseFloat(newAvg));
    onReset();
  };
  if (!adding) return <button style={{ ...btnStyle, border: "1px solid #4CAF50", color: "#4CAF50", padding: "6px 16px" }} onClick={() => setAdding(true)}>+ Add Stock Manually</button>;
  return (
    <div style={{ background: "#e8f5e9", padding: 12, borderRadius: 4, marginTop: 8 }}>
      <input type="text" placeholder="Stock name" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ ...inputStyle, width: 160, marginRight: 8 }} />
      <input type="number" step="any" placeholder="Qty" value={newQty} onChange={(e) => setNewQty(e.target.value)} style={{ ...inputStyle, marginRight: 8 }} />
      <input type="number" step="any" placeholder="Avg price" value={newAvg} onChange={(e) => setNewAvg(e.target.value)} style={{ ...inputStyle, marginRight: 8 }} />
      <button style={{ ...btnStyle, background: "#4CAF50", color: "#fff", border: "none" }} onClick={handleAdd} disabled={!newName.trim() || !newQty || !newAvg}>Save</button>
      <button style={{ ...btnStyle, border: "1px solid #ccc" }} onClick={onReset}>Cancel</button>
    </div>
  );
}

export default PortfolioTable;
