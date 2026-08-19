import type { ServerInfo } from "../../types/cabin";
import "./EmptyServer.css";
export function EmptyServer({ server }: { server: ServerInfo | null }) {
  return <section className="empty-server"><p className="eyebrow">{server?.host}</p><h2>No services discovered</h2><p>Cabin found no eligible service folders in /opt. Add a deployed project folder and refresh.</p><code>root@{server?.host}</code></section>;
}
