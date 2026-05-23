import { Background, Controls, type Edge, ReactFlow, ReactFlowProvider } from "@xyflow/react";
import { createContext, createElement, memo, useContext, useEffect, useLayoutEffect } from "react";
// @ts-expect-error
import "@xyflow/react/dist/style.css";
import { ModelProvider, RegisterFlowToContext } from "./context";
import { edgeTypes } from "./edges";
import { FlowModel, InternalField } from "./injection";
import { edgesModel, handlers, injection, nodesModel } from "./model";
import { nodeTypes } from "./nodes";
import { Dialogs, TopCenterPanel } from "./panel";
import type { AnyWorkNode } from "./type";

export * from "./trans/type";

const proOptions = { hideAttribution: true };

const ReadonlyContext = createContext(false);
export const useReadonly = () => useContext(ReadonlyContext);

function Flow() {
  const [nodes, { onNodesChange }] = nodesModel.use();
  const [edges, { onEdgesChange, onConnect }] = edgesModel.use();
  const { onNodeDragStart, onNodeDragStop, onConnectEnd, onBeforeDelete, onDelete, handleKeyDown } =
    handlers.use();
  const readonly = useReadonly();

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keyboard handler for flow shortcuts
    <div style={{ height: "100%" }} onKeyDown={readonly ? undefined : handleKeyDown}>
      <ReactFlowProvider>
        <ReactFlow<AnyWorkNode, Edge>
          nodes={nodes}
          edges={edges}
          onNodesChange={readonly ? undefined : onNodesChange}
          onEdgesChange={readonly ? undefined : onEdgesChange}
          onConnect={readonly ? undefined : onConnect}
          fitView
          proOptions={proOptions}
          onNodeDragStart={readonly ? undefined : onNodeDragStart}
          onNodeDragStop={readonly ? undefined : onNodeDragStop}
          onConnectEnd={readonly ? undefined : onConnectEnd}
          onBeforeDelete={readonly ? undefined : onBeforeDelete}
          onDelete={readonly ? undefined : onDelete}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!readonly}
          nodesConnectable={!readonly}
          elementsSelectable={!readonly}
        >
          <RegisterFlowToContext />
          <Background />
          <Controls />
          {!readonly && <TopCenterPanel />}
          {!readonly && <Dialogs />}
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

const MemoFlow = memo(Flow);

interface Props {
  model: FlowModel;
  readonly?: boolean;
}

function Connect({ model }: { model: FlowModel }) {
  const { loadSteps } = handlers.use();
  const inject = injection.useCreation();
  const instance = model[InternalField];

  useLayoutEffect(() => {
    return inject(instance);
  }, [instance, inject]);

  useEffect(() => {
    return instance.on("load", loadSteps);
  }, [instance, loadSteps]);

  return <MemoFlow />;
}

export { FlowModel };
// biome-ignore lint/style/noDefaultExport: FlowEditor is the main public component
export default ({ model, readonly = false }: Props) => (
  <ReadonlyContext.Provider value={readonly}>
    <ModelProvider>{createElement(Connect, { model })}</ModelProvider>
  </ReadonlyContext.Provider>
);
