// events/index.js — public exports for the global event bus.
//
// User-code globals: on, emit, any  (registered on window in app.js)
// Subsystems also import: registerCommand
// Internal only (not re-exported to user code): subscribe, clearRunScoped

export {
  emit,
  notify,
  subscribe,
  registerCommand,
  registerSource,
  getLastPayload,
  hasSubscribers,
  clearRunScoped,
  addBusTap,
} from './bus.js';
export { on, any, tick, hold, tween, EventSelector } from './event-selector.js';
export { SYSTEM_EVENTS, DYNAMIC_EVENT_PATTERNS } from './system-events.js';
