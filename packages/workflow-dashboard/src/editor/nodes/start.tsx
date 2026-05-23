import { Handle, type Node, type NodeProps, Position, useNodeConnections } from "@xyflow/react";
import { useMemo } from "react";
import { StartNode } from "./nodes.style";

interface NodeData {
  label: string;
  [key: string]: unknown;
}

type NodeType = Node<NodeData, "start">;
type Props = NodeProps<NodeType>;

export function NodeStart({ data, id }: Props) {
  const connections = useNodeConnections();

  const outputConnected = useMemo(() => {
    return connections.some((conn) => conn.source === id);
  }, [connections, id]);

  return (
    <StartNode>
      {data?.label || "Start"}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        isConnectable={!outputConnected}
      />
    </StartNode>
  );
}
