/** Handle returned by acquireSlot; call release() to free the slot. */
export type SlotHandle = {
  /** Remove the slot file. Idempotent — second call is a no-op. */
  release: () => Promise<void>;
  /** The slot file path (for signal-handler cleanup). */
  slotPath: string;
};

/** Options for acquireSlot polling behavior and callbacks. */
export type AcquireSlotOptions = {
  /** Called when the function starts waiting (all slots occupied). */
  onWaiting: ((info: string) => void) | null;
  /** Called when a slot becomes available after waiting. */
  onAcquired: (() => void) | null;
  /** Poll interval in milliseconds (default: 2000). */
  pollIntervalMs: number;
  /** AbortSignal to cancel waiting. */
  signal: AbortSignal | null;
};
