import React, { useRef, useState } from "react";

const dropStyle = {
  border: "2px dashed #aaa",
  borderRadius: 8,
  padding: 30,
  textAlign: "center",
  cursor: "pointer",
  background: "#fafafa",
};

const dropActiveStyle = { ...dropStyle, borderColor: "#4CAF50", background: "#e8f5e9" };

function UploadArea({ onUpload, uploading }) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef();

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/")
    );
    if (files.length) onUpload(files);
  };

  const handleSelect = (e) => {
    const files = Array.from(e.target.files);
    if (files.length) onUpload(files);
    e.target.value = "";
  };

  return (
    <div
      style={dragOver ? dropActiveStyle : dropStyle}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={handleSelect}
      />
      {uploading ? (
        <p>Uploading...</p>
      ) : (
        <p>Drag & drop screenshots here, or click to select</p>
      )}
    </div>
  );
}

export default UploadArea;
