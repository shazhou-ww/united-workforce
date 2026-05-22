import type { ReactNode } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button.tsx";

type Props = {
  onEdit: (() => void) | undefined;
  onDelete: (() => void) | undefined;
};

export function NodeToolbarActions({ onEdit, onDelete }: Props): ReactNode {
  return (
    <div className="flex gap-1 px-2 py-1 bg-white rounded-lg shadow-md border border-gray-200">
      <Button variant="ghost" size="icon-xs" onClick={onEdit} title="编辑">
        <Pencil />
      </Button>
      <Button variant="ghost" size="icon-xs" className="hover:bg-destructive/10 hover:text-destructive" onClick={onDelete} title="删除">
        <Trash2 />
      </Button>
    </div>
  );
}
