export {
  acquireSlot,
  cleanStaleSlots,
  countActiveSlots,
  DEFAULT_MAX_RUNNING,
  getSlotsDir,
  installSlotCleanup,
  releaseSlot,
} from "./concurrency.js";
export type { AcquireSlotOptions, SlotHandle } from "./types.js";
