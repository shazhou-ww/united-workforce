import { useState } from "react";
import { useNavigate } from "react-router";
import { listWorkflows, runThread } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { Button } from "./ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Textarea } from "./ui/textarea.tsx";

type Props = {
  client: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function RunDialog({ client, open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const workflows = useFetch(() => listWorkflows(client), [client]);
  const [workflow, setWorkflow] = useState("");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!workflow || !prompt) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await runThread(client, workflow, prompt);
      onOpenChange(false);
      navigate(`/${client}/threads/${result.threadId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Run Thread</DialogTitle>
          <DialogDescription>Start a new thread on {client}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="run-workflow" className="text-sm block mb-1.5 text-muted-foreground">
              Workflow
            </label>
            <Select value={workflow} onValueChange={setWorkflow}>
              <SelectTrigger>
                <SelectValue placeholder="Select a workflow..." />
              </SelectTrigger>
              <SelectContent>
                {workflows.status === "ok" &&
                  workflows.data.workflows.map((w) => (
                    <SelectItem key={w.name} value={w.name}>
                      {w.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label htmlFor="run-prompt" className="text-sm block mb-1.5 text-muted-foreground">
              Prompt
            </label>
            <Textarea
              id="run-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="Enter the task prompt..."
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !workflow || !prompt}>
              {submitting ? "Starting..." : "Run"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
