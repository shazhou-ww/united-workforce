import { Handle, Position, Node, NodeProps } from '@xyflow/react';
import { EndNode } from './nodes.style';

interface NodeData {
  label: string;
  [key: string]: unknown;
}

type NodeType = Node<NodeData, 'end'>;
type Props = NodeProps<NodeType>;

export function NodeEnd({ data }: Props) {
  return (
    <EndNode>
      <Handle
        type="target"
        position={Position.Left}
        id="input"
      />
      {data?.label || 'End'}
    </EndNode>
  );
}
