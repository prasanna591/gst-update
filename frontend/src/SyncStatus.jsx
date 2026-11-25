import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "./api";
import { useConfirm } from "./confirmContext";

export default function SyncStatus() {
  const askConfirm = useConfirm();
  const [s, setS] = useState(null);
  const [error, setError] = useState("");
  const first = useRef(null);

  async function load() {
    try {
      const r = await api.get("/api/sync/status");
      if (first.current === null) first.current = r.data.version;
      else if (r.data.version !== first.current) { window.location.reload(); return; }
      setS(r.data);
    } catch { /* backend not reachable */ }
  }
  useEffect(() => { load(); const id = setInterval(load, 20000); return () => clearInterval(id); }, []);

  async function resolve(keep) {
    const ok = await askConfirm({
      title: "Resolve sync conflict?",
      message: keep === "drive"
        ? "The data on this laptop will be replaced with the Google Drive data."
        : "The Google Drive data will be replaced with the data on this laptop.",
      confirmLabel: keep === "drive" ? "Use Google data" : "Keep laptop data",
      tone: "default",
    });
    if (!ok) return;
    try {
      const r = await api.post("/api/sync/resolve", { keep });
      if (r.data?.status === "error") {
        setError(r.data.error || "Sync failed.");
        return;
      }
      setError("");
      load();
    } catch {
      setError("Could not resolve the conflict. Please try again.");
    }
  }

  if (!s || !s.supported) return null;
  if (!s.connected) {
    return <Link to="/settings" className="sync-pill off"><i /> Google backup is off</Link>;
  }
  if (s.status === "conflict") {
    return (
      <div style={{ fontSize: 12, padding: 8, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10 }}>
        <strong style={{ color: "#b91c1c" }}>Two versions of your data exist.</strong>
        <div style={{ display: "grid", gap: 6, marginTop: 6 }}>
          <button className="secondary-btn" onClick={() => resolve("local")}>Keep this laptop</button>
          <button className="secondary-btn" onClick={() => resolve("drive")}>Use Google Drive data</button>
          {error && <span style={{ color: "#b91c1c" }}>{error}</span>}
        </div>
      </div>
    );
  }
  const [cls, text] = s.pending ? ["wait", "Changes waiting to upload"]
    : s.status === "offline" ? ["off", "Offline. Will sync later"]
    : s.status === "error" ? ["bad", "Sync problem"]
    : ["ok", "Synced with Google Drive"];
  return (
    <div className={`sync-pill ${cls}`} title={s.error || (s.last_sync ? `Last sync: ${s.last_sync}` : "")}>
      <i /> {text}
    </div>
  );
}