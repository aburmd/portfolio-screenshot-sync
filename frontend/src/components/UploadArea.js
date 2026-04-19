import React, { useRef, useState } from "react";

const PLATFORMS = ["INDmoney", "Webull", "Robinhood", "Fidelity"];

const dropStyle = {
  border: "2px dashed #aaa", borderRadius: 8, padding: 30,
  textAlign: "center", cursor: "pointer", background: "#fafafa",
};
const dropActiveStyle = { ...dropStyle, borderColor: "#4CAF50", background: "#e8f5e9" };

function UploadArea({ onUpload, uploading }) {
  const [dragOver, setDragOver] = useState(false);
  const [platform, setPlatform] = useState("INDmoney");
  const [customPlatform, setCustomPlatform] = useState("");
  const inputRef = useRef();

  const selectedPlatform = platform === "__other__" ? customPlatform.trim() : platform;

  const handleFiles = (files) => {
    if (!selectedPlatform) return alert("Please select a platform first");
    if (files.length) onUpload(files, selectedPlatform.toLowerCase());
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/")));
  };

  const handleSelect = (e) => {
    handleFiles(Array.from(e.target.files));
    e.target.value = "";
  };

  return (
    <div>
      <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        <label style={{ fontWeight: "bold", fontSize: 13 }}>Platform:</label>
        <select value={platform} onChange={(e) => setPlatform(e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid #ccc" }}>
          {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__other__">Other...</option>
        </select>
        {platform === "__other__" && (
          <input type="text" placeholder="Enter platform name" value={customPlatform}
            onChange={(e) => setCustomPlatform(e.target.value)}
            style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: 4, width: 150 }} />
        )}
      </div>

      <div
        style={dragOver ? dropActiveStyle : dropStyle}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
      >
        <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleSelect} />
        {uploading ? (
          <p>Uploading to <strong>{selectedPlatform}</strong>...</p>
        ) : (
          <div>
            <p>Drag & drop <strong>{selectedPlatform}</strong> screenshots here, or click to select</p>
            {platform === "Robinhood" && (
              <p style={{ fontSize: 11, color: "#888", margin: "4px 0 0" }}>
                Robinhood needs 2 screenshots of the same stocks: one showing $ values, one showing % returns
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default UploadArea;
