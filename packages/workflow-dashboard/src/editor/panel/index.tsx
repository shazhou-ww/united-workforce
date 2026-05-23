import { Panel } from "@xyflow/react";
import { AddNodeDialog } from "./add-node";
import { EditNodeDialog } from "./edit-node";
import { Toolbar } from "./toolbar";

export function Dialogs() {
  return (
    <>
      <AddNodeDialog />
      <EditNodeDialog />
    </>
  );
}

export function TopCenterPanel() {
  return (
    <Panel position="top-center">
      <Toolbar />
    </Panel>
  );
}
