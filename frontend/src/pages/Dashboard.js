import React, { useState, useEffect, useCallback } from "react";
import UploadArea from "../components/UploadArea";
import PortfolioTable from "../components/PortfolioTable";
import { fetchPortfolio, uploadScreenshot, downloadCsv } from "../services/api";

function Dashboard({ user }) {
  const [portfolio, setPortfolio] = useState([]);
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
    } catch (e) {
      setMessage("Failed to load portfolio");
    }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    loadPortfolio();
  }, [loadPortfolio]);

  const handleUpload = async (files) => {
    if (!userId || files.length === 0) return;
    setUploading(true);
    setMessage("");
    try {
      for (const file of files) {
        await uploadScreenshot(userId, file);
      }
      setMessage(`Uploaded ${files.length} file(s). Processing... refresh in a few seconds.`);
      setTimeout(loadPortfolio, 5000);
    } catch (e) {
      setMessage("Upload failed: " + e.message);
    }
    setUploading(false);
  };

  const handleDownloadCsv = async () => {
    if (!userId) return;
    try {
      await downloadCsv(userId);
    } catch (e) {
      setMessage("CSV download failed");
    }
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

      <PortfolioTable data={portfolio} loading={loading} />
    </div>
  );
}

export default Dashboard;
