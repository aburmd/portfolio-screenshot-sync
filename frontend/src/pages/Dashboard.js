import React, { useState, useEffect, useCallback } from "react";
import UploadArea from "../components/UploadArea";
import PortfolioTable from "../components/PortfolioTable";
import { fetchPortfolio, uploadScreenshots, downloadCsv, deleteStock, updateStock, addStock, fetchPrices } from "../services/api";

function Dashboard({ user }) {
  const [portfolio, setPortfolio] = useState([]);
  const [prices, setPrices] = useState({});
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  const userId = user?.userId || user?.username;

  const loadPortfolio = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const data = await fetchPortfolio(userId);
      setPortfolio(data);
      // Fetch live prices for all known symbols
      const symbols = [...new Set(data.map((d) => d.symbol).filter((s) => s && s !== "UNKNOWN"))];
      if (symbols.length > 0) {
        const priceData = await fetchPrices(symbols);
        setPrices(priceData);
      }
    } catch (e) {
      setMessage("Failed to load portfolio");
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => { loadPortfolio(); }, [loadPortfolio]);

  const handleUpload = async (files) => {
    if (!userId || files.length === 0) return;
    setUploading(true);
    setMessage("");
    try {
      const result = await uploadScreenshots(userId, files);
      setMessage(`Uploaded ${result.uploaded} file(s). Processing... refresh in a few seconds.`);
      setTimeout(loadPortfolio, 5000);
    } catch (e) {
      setMessage("Upload failed: " + e.message);
    }
    setUploading(false);
  };

  const handleDelete = async (stockName) => {
    try {
      await deleteStock(userId, stockName);
      setMessage(`Deleted "${stockName}"`);
      loadPortfolio();
    } catch (e) {
      setMessage("Delete failed: " + e.message);
    }
  };

  const handleUpdate = async (stockName, quantity, avgBuyPrice) => {
    try {
      await updateStock(userId, stockName, quantity, avgBuyPrice);
      setMessage(`Updated "${stockName}"`);
      loadPortfolio();
    } catch (e) {
      setMessage("Update failed: " + e.message);
    }
  };

  const handleAdd = async (stockName, quantity, avgBuyPrice) => {
    try {
      const result = await addStock(userId, stockName, quantity, avgBuyPrice);
      setMessage(`Added "${stockName}" (${result.symbol})`);
      loadPortfolio();
    } catch (e) {
      setMessage("Add failed: " + e.message);
    }
  };

  const handleDownloadCsv = async () => {
    try { await downloadCsv(userId); } catch (e) { setMessage("CSV download failed"); }
  };

  return (
    <div>
      <UploadArea onUpload={handleUpload} uploading={uploading} />
      {message && <p style={{ color: "#666", marginTop: 10 }}>{message}</p>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 30 }}>
        <h3 style={{ margin: 0 }}>My Portfolio</h3>
        <div>
          <button onClick={loadPortfolio} disabled={loading} style={{ marginRight: 8 }}>
            {loading ? "Loading..." : "Refresh"}
          </button>
          <button onClick={handleDownloadCsv} disabled={portfolio.length === 0}>
            Download CSV
          </button>
        </div>
      </div>

      <PortfolioTable data={portfolio} prices={prices} loading={loading}
        onDelete={handleDelete} onUpdate={handleUpdate} onAdd={handleAdd} />
    </div>
  );
}

export default Dashboard;
