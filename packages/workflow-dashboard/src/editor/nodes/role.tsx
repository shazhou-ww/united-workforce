import { Handle, Position, NodeToolbar, useNodeConnections, type NodeProps } from '@xyflow/react';
import { Users } from 'lucide-react';
import {
  NodeContent,
  NodeBody,
  RoleIcon,
  RoleKindLabel,
  NodeHint,
} from './nodes.style';
import { NodeToolbarActions } from './node-toolbar';
import { editNodeViewModel } from '../model/edit-node-view';
import { nodesModel } from '../model';
import type { WorkNode } from '../type';
import { useMemo, type ReactNode } from 'react';
import { useReadonly } from '../flow';

type Props = NodeProps<WorkNode<'role'>>;

const containerClass = "bg-white border border-gray-200 rounded-[10px] shadow-sm transition-all duration-200 hover:shadow-md hover:border-gray-400 [&_.react-flow\\_\\_handle]:w-3 [&_.react-flow\\_\\_handle]:h-3 [&_.react-flow\\_\\_handle]:border-2 [&_.react-flow\\_\\_handle]:transition-all [&_.react-flow\\_\\_handle]:duration-150";
const targetClass = "!bg-blue-100 !border-blue-500 hover:!bg-blue-500 hover:!border-blue-600";
const sourceClass = "!bg-emerald-100 !border-emerald-500 hover:!bg-emerald-500 hover:!border-emerald-600";

export function NodeRole({ data, id, selected }: Props) {
  const startEdit = editNodeViewModel.useCreation().start;
  const { deleteNode } = nodesModel.useCreation();
  const connections = useNodeConnections();
  const readonly = useReadonly();

  const connectedHandles = useMemo(() => {
    const set = new Set<string>();
    for (const c of connections) {
      if (c.target === id && c.targetHandle) set.add(c.targetHandle);
      if (c.source === id && c.sourceHandle) set.add(c.sourceHandle);
    }
    return set;
  }, [connections, id]);

  const hasInputConnection = connectedHandles.has('input') || connectedHandles.has('input-top') || connectedHandles.has('input-bottom');
  const hasOutputConnection = connectedHandles.has('output') || connectedHandles.has('output-top') || connectedHandles.has('output-bottom');

  const showHandle = (handleId: string, alwaysShow: boolean) => {
    if (readonly) return connectedHandles.has(handleId);
    return alwaysShow;
  };

  return (
    <div className={containerClass}>
      {showHandle('input', true) && <Handle type="target" position={Position.Left} id="input" className={targetClass} isConnectableStart />}
      {showHandle('input-top', hasInputConnection) && <Handle type="target" position={Position.Top} id="input-top" style={{ left: '30%' }} className={targetClass} isConnectableStart />}
      {showHandle('input-bottom', hasInputConnection) && <Handle type="target" position={Position.Bottom} id="input-bottom" style={{ left: '30%' }} className={targetClass} isConnectableStart />}
      <NodeContent>
        <RoleIcon>
          <Users size={16} />
        </RoleIcon>
        <NodeBody>
          <RoleKindLabel>Role</RoleKindLabel>
          <NodeHint>{data.name}</NodeHint>
        </NodeBody>
      </NodeContent>
      <NodeToolbar isVisible={selected && !readonly} position={Position.Bottom}>
        <NodeToolbarActions
          onEdit={() => startEdit(id)}
          onDelete={() => deleteNode(id)}
        />
      </NodeToolbar>
      {showHandle('output', true) && <Handle type="source" position={Position.Right} id="output" className={sourceClass} isConnectableEnd />}
      {showHandle('output-top', hasOutputConnection) && <Handle type="source" position={Position.Top} id="output-top" style={{ left: '70%' }} className={sourceClass} isConnectableEnd />}
      {showHandle('output-bottom', hasOutputConnection) && <Handle type="source" position={Position.Bottom} id="output-bottom" style={{ left: '70%' }} className={sourceClass} isConnectableEnd />}
    </div>
  );
}
