/**
 * air-book kotoba — barrel. kotoba-E2E split: plaintext public flight facts
 * (flightSegment, seatAssignment) + kotoba-E2E sensitive payload (pnr, eTicket,
 * ancillary, reprotection = PII + confidential commercial terms, ADR-2605181100).
 * IATA-BSP fiat-clearing settlement EXECUTION stays etzhayyim via consent-capability.
 */
export * from "./types.js";
export {
  registerSegment,
  setSegmentStatus,
  getSegment,
  listSegments,
  assignSeat,
  listSeatAssignments,
  createPnr,
  listPnrs,
  getPnr,
  issueTicket,
  getTicket,
  addAncillary,
  reprotectPassenger,
  coverage,
} from "./registry.js";
