const API_BASE = process.env.REACT_APP_API_URL || "http://localhost:8000";

export async function fetchPortfolio(userId) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}`);
  if (!res.ok) throw new Error("Failed to fetch portfolio");
  return res.json();
}

export async function uploadScreenshots(userId, files) {
  const formData = new FormData();
  formData.append("user_id", userId);
  for (const file of files) {
    formData.append("files", file);
  }
  const res = await fetch(`${API_BASE}/upload`, { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  return res.json();
}

export async function addStock(userId, stockName, quantity, avgBuyPrice) {
  const formData = new FormData();
  formData.append("stock_name", stockName);
  formData.append("quantity", quantity);
  formData.append("avg_buy_price", avgBuyPrice);
  const res = await fetch(`${API_BASE}/portfolio/${userId}/add`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error("Add failed");
  return res.json();
}

export async function deleteStock(userId, stockName) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}/${encodeURIComponent(stockName)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Delete failed");
  return res.json();
}

export async function updateStock(userId, stockName, quantity, avgBuyPrice) {
  const formData = new FormData();
  formData.append("quantity", quantity);
  formData.append("avg_buy_price", avgBuyPrice);
  const res = await fetch(`${API_BASE}/portfolio/${userId}/${encodeURIComponent(stockName)}`, {
    method: "PUT",
    body: formData,
  });
  if (!res.ok) throw new Error("Update failed");
  return res.json();
}

export async function downloadCsv(userId) {
  const res = await fetch(`${API_BASE}/portfolio/${userId}/csv`);
  if (!res.ok) throw new Error("CSV download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "portfolio.csv";
  a.click();
  URL.revokeObjectURL(url);
}
