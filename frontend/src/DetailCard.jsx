import { X } from "lucide-react";

export default function DetailCard({ detail, onClose, actions }) {
  if (!detail) return null;
  const rows = (detail.rows || []).filter(([, value]) => value !== null && value !== undefined && value !== "");

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal detail-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-heading detail-card-head">
          <div>
            <h2>{detail.title}</h2>
            {detail.subtitle && <p>{detail.subtitle}</p>}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close details"><X /></button>
        </div>

        {rows.length > 0 && (
          <dl className="detail-card-grid">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {detail.note && (
          <div className="detail-card-note">
            <strong>Notes</strong>
            <p>{detail.note}</p>
          </div>
        )}

        {actions && <div className="modal-actions">{actions}</div>}
      </section>
    </div>
  );
}
