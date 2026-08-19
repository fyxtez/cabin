import type { ServiceAction, ServiceStatus } from "../../types/cabin";
import { canStopService, getStatusTone } from "../../utils/services";
import "./ServiceCard.css";

type Props = { service: ServiceStatus; busy: boolean; logsOpen: boolean; onOpenLogs: () => void; onAction: (action: ServiceAction) => void };
export function ServiceCard({ service, busy, logsOpen, onOpenLogs, onAction }: Props) {
  const tone = getStatusTone(service);
  const canStop = canStopService(service);
  return <article className="service-card">
    <div className="card-heading"><span className={`status-dot ${tone}`} /><div><h2>{service.name}</h2><p>{service.description}</p></div><span className={`status-label ${tone}`}>{service.subState}</span></div>
    <dl className="metadata"><div><dt>State</dt><dd>{service.activeState}</dd></div><div><dt>PID</dt><dd>{service.mainPid === "0" ? "—" : service.mainPid}</dd></div><div><dt>Active since</dt><dd>{service.activeSince || "—"}</dd></div></dl>
    {service.loadState === "not-found" && <p className="unit-warning">Unit {service.unit} was not found. Check its configured name.</p>}
    <div className="actions"><button className="logs-button" disabled={logsOpen} onClick={onOpenLogs}>{logsOpen ? "Logs open" : "Logs"}</button>{canStop ? <button className="stop-button" disabled={busy} onClick={() => onAction("stop")}>Stop</button> : <button className="start-button" disabled={busy} onClick={() => onAction("start")}>Start</button>}<button className="restart-button" disabled={busy || service.activeState !== "active"} onClick={() => onAction("restart")}>{busy ? "Working…" : "Restart"}</button></div>
  </article>;
}
