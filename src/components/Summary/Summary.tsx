import "./Summary.css";
export function Summary({ total, active, failed }: { total: number; active: number; failed: number }) {
  return <section className="summary" aria-label="Service overview"><div><strong>{total}</strong><span>services</span></div><div><strong className="green">{active}</strong><span>active</span></div><div><strong className={failed ? "red" : ""}>{failed}</strong><span>failed</span></div></section>;
}
