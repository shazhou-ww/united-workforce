import { Handle, Position, Node, NodeProps, useNodeConnections } from '@xyflow/react';
import { StartNode } from './nodes.style';
import { useMemo } from 'react';

interface NodeData {
  label: string;
  [key: string]: unknown;
}

type NodeType = Node<NodeData, 'start'>;
type Props = NodeProps<NodeType>;

export function NodeStart({ data, id }: Props) {
  const connections = useNodeConnections();

  const outputConnected = useMemo(() => {
    return connections.some((conn) => conn.source === id);
  }, [connections, id]);

  return (
    <StartNode>
      {data?.label || 'Start'}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        isConnectable={!outputConnected}
      />
    </StartNode>
  );
}
