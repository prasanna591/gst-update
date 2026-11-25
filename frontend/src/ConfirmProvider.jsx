import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import { ConfirmContext } from "./confirmContext";

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const [checked, setChecked] = useState(false);
  const resolverRef = useRef(null);
  const confirmButtonRef = useRef(null);

  const close = useCallback((result) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setDialog(null);
    setChecked(false);
    if (resolve) resolve(result);
  }, []);

  const confirm = useCallback((options) => {
    const config = typeof options === "string" ? { message: options } : options || {};
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setChecked(false);
      setDialog({
        title: config.title || "Please confirm",
        message: config.message || "",
        confirmLabel: config.confirmLabel || "Confirm",
        checkLabel: config.checkLabel || "",
        tone: config.tone || "danger",
      });
    });
  }, []);

  useEffect(() => {
    if (!dialog) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    confirmButtonRef.current?.focus();
    const onKey = (event) => {
      if (event.key === "Escape") close(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, [dialog, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {dialog && (
        <div className="modal-backdrop" onClick={() => close(false)}>
          <section className="modal confirm-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <h2><AlertCircle size={18} /> {dialog.title}</h2>
              <button className="icon-btn" onClick={() => close(false)} title="Close"><X /></button>
            </div>
            <p className="settings-hint">{dialog.message}</p>
            {dialog.checkLabel && (
              <label className="checkbox-field confirm-check">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => setChecked(event.target.checked)}
                />
                {dialog.checkLabel}
              </label>
            )}
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => close(false)}>Cancel</button>
              <button
                ref={confirmButtonRef}
                className={dialog.tone === "danger" ? "primary-btn danger-btn" : "primary-btn"}
                disabled={Boolean(dialog.checkLabel) && !checked}
                onClick={() => close(true)}
              >
                {dialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
