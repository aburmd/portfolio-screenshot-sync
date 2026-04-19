import React from "react";

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 12,
};

const thStyle = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "2px solid #ddd",
  background: "#f5f5f5",
};

const tdStyle = {
  padding: "8px 12px",
  borderBottom: "1px solid #eee",
};

function PortfolioTable({ data, loading }) {
  if (loading) return <p>Loading...</p>;
  if (!data || data.length === 0) return <p style={{ color: "#999" }}>No stocks yet. Upload a screenshot to get started.</p>;

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
        </tr>
      </thead>
      <tbody>
        {data.map((row, i) => (
          <tr key={row.symbol || i}>
            <td style={tdStyle}>
              <strong>{row.symbol}</strong>
              {row.symbol === "UNKNOWN" && <span style={{ color: "red", marginLeft: 4 }}>⚠</span>}
            </td>
            <td style={tdStyle}>{row.stock_name}</td>
            <td style={tdStyle}>{row.quantity}</td>
            <td style={tdStyle}>${row.avg_buy_price}</td>
            <td style={tdStyle}>{row.platform_name}</td>
            <td style={tdStyle}>{row.uploaded_date?.split("T")[0]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default PortfolioTable;
