import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, User, FileText, IndianRupee } from "lucide-react";
import api from "./api";
import "./App.css";

const ICONS = { client: User, filing: FileText, fee: IndianRupee };

export default function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);

  const search = useCallback(async (q) => {
    if (!q.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    try {
      const r = await api.get("/api/search", { params: { q } });
      const matched = r.data?.results || [];
      setResults(matched);
      setOpen(matched.length > 0);
    } catch {
      setResults([]);
      setOpen(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(query), 250);
    return () => clearTimeout(t);
  }, [query, search]);

  useEffect(() => {
    const handleClick = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="global-search" ref={inputRef}>
      <div className="gs-input">
        <Search size={14} />
        <input
          className="gs-field"
          placeholder="Search clients, filings, fees&hellip;"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => { if (query.trim()) setOpen(results.length > 0); }}
        />
        {query.trim() && (
          <button className="gs-clear" onClick={() => { setQuery(""); setResults([]); setOpen(false); }}>
            <X size={12} />
          </button>
        )}
      </div>
      {open && results.length > 0 && (
        <div className="gs-dropdown">
          {results.map((item) => {
            const Icon = ICONS[item.type] || User;
            return (
              <button
                key={`${item.type}-${item.id}`}
                className="gs-item"
                onClick={() => {
                  setQuery("");
                  setResults([]);
                  setOpen(false);
                  navigate(item.link || "/clients");
                }}
              >
                <Icon size={14} style={{ marginRight: 8, color: "#64748b" }} />
                <span>{item.title}</span>
                {item.subtitle ? <small>{item.subtitle}</small> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
