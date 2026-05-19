# @uncaged/workflow-cas

Content-addressable storage implementation, bundle hashing, and Merkle helpers.

## What This Package Does

It implements `CasStore` from `@uncaged/workflow-protocol`, hashes workflow bundle bytes and strings with XXH64, and builds serializable Merkle nodes for thread/step/content payloads used when persisting execution artifacts.

## Key Exports

From `src/index.ts`:

- **CAS:** `createCasStore`
- **Hash:** `hashString`, `hashWorkflowBundleBytes`
- **Merkle:** `createContentMerkleNode`, `getContentMerklePayload`, `parseMerkleNode`, `putContentMerkleNode`, `putStepMerkleNode`, `putThreadMerkleNode`, `serializeMerkleNode`
- **Types:** `CasStore`, `MerkleNode`, `MerkleNodeType`, `StepMerklePayload`, `ThreadMerklePayload`

## Dependencies

- **Workspace:** `@uncaged/workflow-protocol` (`CasStore` contract), `@uncaged/workflow-util`
- **npm:** `xxhashjs`, `yaml`

## Usage

```typescript
import { createCasStore, hashWorkflowBundleBytes } from "@uncaged/workflow-cas";
import { getGlobalCasDir } from "@uncaged/workflow-util";

const store = createCasStore(getGlobalCasDir());
const hash = await hashWorkflowBundleBytes(esmJsBytes);
```
