import type { ServiceAction, ServiceStatus } from "../../types/cabin";
import { formatGroupName } from "../../utils/services";
import { ServiceCard } from "../ServiceCard/ServiceCard";
import "./ServiceSections.css";

type Group = { state: string; services: ServiceStatus[] };
type Props = { groups: Group[]; busyUnit: string | null; selectedUnit?: string; onSelect: (service: ServiceStatus) => void; onAction: (service: ServiceStatus, action: ServiceAction) => void };
export function ServiceSections({ groups, busyUnit, selectedUnit, onSelect, onAction }: Props) {
  return <div className="service-sections">{groups.map((group) => <section className={`service-section state-${group.state}`} key={group.state}><header className="section-heading"><span className="section-state-dot"/><h2>{formatGroupName(group.state)}</h2><span className="section-count">{group.services.length}</span><span className="section-rule"/></header><div className="service-grid">{group.services.map((service) => <ServiceCard key={service.unit} service={service} busy={busyUnit === service.unit} logsOpen={selectedUnit === service.unit} onOpenLogs={() => onSelect(service)} onAction={(action) => onAction(service, action)} />)}</div></section>)}</div>;
}
