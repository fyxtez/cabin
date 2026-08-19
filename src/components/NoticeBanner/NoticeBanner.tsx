import type { Notice } from "../../types/cabin";
import "./NoticeBanner.css";
export function NoticeBanner({ notice, onDismiss }: { notice: Exclude<Notice, null>; onDismiss: () => void }) {
  return <div className={`notice ${notice.kind}`} role="status"><span>{notice.message}</span><button onClick={onDismiss} aria-label="Dismiss message">×</button></div>;
}
