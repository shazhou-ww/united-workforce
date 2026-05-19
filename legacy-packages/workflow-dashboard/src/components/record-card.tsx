import { CheckCircle2, Clock, MessageSquare, Rocket, User, XCircle } from "lucide-react";
import type { RoleRecord, ThreadRecord, ThreadStartRecord, WorkflowResultRecord } from "../api.ts";
import { cn } from "../lib/utils.ts";
import { Markdown } from "./markdown.tsx";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";

const ROLE_HUES = [262, 210, 35, 150, 330, 180, 15, 280, 55, 195, 345, 120, 240, 75, 305];

function roleHue(role: string): number {
  let hash = 0;
  for (let i = 0; i < role.length; i++) {
    hash = (hash * 31 + role.charCodeAt(i)) | 0;
  }
  return ROLE_HUES[Math.abs(hash) % ROLE_HUES.length];
}

function roleBadgeStyle(role: string): { backgroundColor: string; borderColor: string } {
  const hue = roleHue(role);
  return {
    backgroundColor: `oklch(0.58 0.12 ${hue} / 0.85)`,
    borderColor: `oklch(0.58 0.12 ${hue} / 0.25)`,
  };
}

function formatTime(ts: number | null): string | null {
  if (ts === null) return null;
  return new Date(ts).toLocaleTimeString();
}

function StartCard({ record }: { record: ThreadStartRecord }) {
  return (
    <Card className="p-4 transition-all duration-200 overflow-hidden relative">
      <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-primary/80 via-primary/40 to-transparent" />
      <div className="flex items-center gap-2 mb-2">
        <Rocket className="h-5 w-5 text-primary" />
        <span className="font-semibold text-foreground">{record.workflow}</span>
        <Badge variant={record.status === "active" ? "success" : "secondary"}>
          {record.status}
        </Badge>
      </div>
      {record.prompt !== null && (
        <div className="mt-2 p-3 rounded-md text-sm border-l-2 border-ring bg-muted/50">
          <div className="text-xs mb-1 text-muted-foreground flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            Prompt
          </div>
          <Markdown content={record.prompt} />
        </div>
      )}
    </Card>
  );
}

function RoleMessage({ record, highlighted }: { record: RoleRecord; highlighted: boolean }) {
  const style = roleBadgeStyle(record.role);
  return (
    <Card
      className={cn(
        "p-3 text-sm transition-all duration-200 border-l-4",
        highlighted && "wf-record-card-highlight",
      )}
      style={{ borderLeftColor: style.borderColor }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className="text-xs px-2 py-0.5 rounded font-mono font-medium text-white shadow-sm inline-flex items-center gap-1"
          style={{ backgroundColor: style.backgroundColor }}
        >
          <User className="h-3 w-3" />
          {record.role}
        </span>
        {formatTime(record.timestamp) !== null && (
          <span className="text-xs ml-auto text-muted-foreground tabular-nums flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTime(record.timestamp)}
          </span>
        )}
      </div>
      <Markdown content={record.content} />
    </Card>
  );
}

function ResultCard({ record }: { record: WorkflowResultRecord }) {
  const success = record.returnCode === 0;
  return (
    <Card
      className={cn(
        "p-4 transition-all duration-200 border-l-4",
        success ? "border-l-success" : "border-l-destructive",
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        {success ? (
          <CheckCircle2 className="h-5 w-5 text-success" />
        ) : (
          <XCircle className="h-5 w-5 text-destructive" />
        )}
        <span className="font-semibold text-sm">{success ? "Completed" : "Failed"}</span>
        <Badge variant="outline" className="font-mono">
          exit {record.returnCode}
        </Badge>
        {formatTime(record.timestamp) !== null && (
          <span className="text-xs ml-auto text-muted-foreground tabular-nums flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatTime(record.timestamp)}
          </span>
        )}
      </div>
      <Markdown content={record.content} />
    </Card>
  );
}

type RecordCardProps = {
  record: ThreadRecord;
  highlighted: boolean;
};

export function RecordCard({ record, highlighted }: RecordCardProps) {
  switch (record.type) {
    case "thread-start":
      return <StartCard record={record} />;
    case "role":
      return <RoleMessage record={record} highlighted={highlighted} />;
    case "workflow-result":
      return <ResultCard record={record} />;
  }
}
