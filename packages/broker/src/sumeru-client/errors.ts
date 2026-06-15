/**
 * Typed error for the 404 `session_not_found` case so `broker.send()` can
 * recognise it and trigger the silent retry path.
 *
 * Per CLAUDE.md, classes are allowed for `Error` subclasses.
 */

import { SUMERU_SESSION_NOT_FOUND } from "./types.js";

export class SumeruSessionNotFoundError extends Error {
  readonly code = SUMERU_SESSION_NOT_FOUND;
  readonly gateway: string;
  readonly sessionId: string;
  constructor(gateway: string, sessionId: string) {
    super(`sumeru session ${sessionId} not found on gateway ${gateway}`);
    this.name = "SumeruSessionNotFoundError";
    this.gateway = gateway;
    this.sessionId = sessionId;
  }
}
