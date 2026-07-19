/**
 * air-book kotoba — kotoba-E2E split for airline reservations + ticketing.
 *
 * Per ADR-2606011400 (Consensys) + ADR-2605172400 (3-axis) + ADR-2605181100
 * (kotoba E2E encrypted-record envelope). Founder directive 2026-06-03: PII /
 * CUI / commercial terms may migrate to etzhayyim when made safe via kotoba E2E.
 *
 * SPLIT (discriminator: a field is E2E if it carries a passenger/party identity,
 * a confidential commercial term (fare / form of payment), or per-person
 * itinerary content; pure operational flight facts are plaintext):
 *
 *   PUBLIC (plaintext AT records) — operational flight anchors with NO party
 *   identity: `flightSegment` (flightNo, carrier, origin, dest, depDate, cabin,
 *   status = published schedule fact) and `seatAssignment` (recordLocator ↔
 *   flightNo ↔ seatNo seat-map load fact, no passenger name). FK seatAssignment
 *   → flightSegment via exists(). Frontable open metadata + aggregate stats.
 *
 *   SENSITIVE (kotoba E2E, com.etzhayyim.encrypted.record) — `pnr` (passenger
 *   name record: passenger names + DIDs + contact = PII), `eTicket` (ticket
 *   number + fare + form-of-payment = PII + confidential commercial term),
 *   `ancillary` (per-passenger ancillary purchase = commercial) and
 *   `reprotection` (per-passenger reaccommodation itinerary = PII). Written via
 *   sdk.encryptedWrite (read-cap = owner DID + explicit recipients). The
 *   substrate never sees these in plaintext.
 *
 *   STAYS etzhayyim (consumed via consent-capability, NOT a collection) — IATA-BSP
 *   fiat-clearing settlement EXECUTION (settleBsp money movement through the
 *   BSP fiat rail) is regulated merchant-of-record settlement; per ADR-2605172100
 *   etzhayyim never becomes the fiat counterparty. The ticket/fare LEDGER DATA
 *   migrates as E2E eTicket records; only the fiat clearing CALL stays etzhayyim.
 *
 * AT-Lexicon: no float — fares/amounts are decimal STRINGS; seat row + pax
 * counts are integers.
 */

// ─── Plaintext public collections ───────────────────────────────────
export const FLIGHT_SEGMENT_COLLECTION = "com.etzhayyim.apps.airBook.flightSegment";
export const SEAT_ASSIGNMENT_COLLECTION = "com.etzhayyim.apps.airBook.seatAssignment";

// ─── E2E inner-type NSIDs (body shape inside the encrypted envelope) ──
export const PNR_INNER_TYPE = "com.etzhayyim.apps.airBook.pnr";
export const ETICKET_INNER_TYPE = "com.etzhayyim.apps.airBook.eTicket";
export const ANCILLARY_INNER_TYPE = "com.etzhayyim.apps.airBook.ancillary";
export const REPROTECTION_INNER_TYPE = "com.etzhayyim.apps.airBook.reprotection";

export const AIR_BOOK_DID_PREFIX = "did:web:air-book.etzhayyim.com:" as const;

// ─── Flight segment anchor (PLAINTEXT, public operational metadata) ──

export interface FlightSegmentRecord {
  did: string;
  flightNo: string;
  carrier: string;
  origin: string;
  dest: string;
  depDate: string;
  cabin?: string;
  status: string;
  createdAt: string;
}
export interface FlightSegmentView extends FlightSegmentRecord {
  segmentUri: string;
}
export interface RegisterSegmentInput {
  flightNo: string;
  carrier: string;
  origin: string;
  dest: string;
  depDate: string;
  cabin?: string;
  status?: string;
}
export interface RegisterSegmentOutput {
  status: "registered" | "alreadyExists" | "rejected";
  segmentUri?: string;
  did?: string;
  flightNo?: string;
  error?: string;
}
export interface SetSegmentStatusInput {
  flightNo: string;
  depDate: string;
  status: string;
}
export interface SetSegmentStatusOutput {
  status: "updated" | "rejected";
  segmentUri?: string;
  flightNo?: string;
  error?: string;
}
export interface GetSegmentInput {
  flightNo: string;
  depDate: string;
}
export interface GetSegmentOutput {
  segment?: FlightSegmentView;
  error?: string;
}
export interface ListSegmentsInput {
  dest?: string;
  status?: string;
  limit?: number;
  cursor?: string;
}
export interface ListSegmentsOutput {
  items: FlightSegmentView[];
  cursor?: string;
  total: number;
}

// ─── Seat assignment (PLAINTEXT, FK → flightSegment) ─────────────────

export interface SeatAssignmentRecord {
  did: string;
  recordLocator: string;
  flightNo: string;
  depDate: string;
  seatNo: string;
  cabin?: string;
  createdAt: string;
}
export interface SeatAssignmentView extends SeatAssignmentRecord {
  assignmentUri: string;
}
export interface AssignSeatInput {
  recordLocator: string;
  flightNo: string;
  depDate: string;
  seatNo: string;
  cabin?: string;
}
export interface AssignSeatOutput {
  status: "assigned" | "alreadyExists" | "segmentNotFound" | "rejected";
  assignmentUri?: string;
  did?: string;
  error?: string;
}
export interface ListSeatAssignmentsInput {
  flightNo?: string;
  recordLocator?: string;
  limit?: number;
  cursor?: string;
}
export interface ListSeatAssignmentsOutput {
  items: SeatAssignmentView[];
  cursor?: string;
  total: number;
}

// ─── PNR (E2E-ENCRYPTED, passenger PII) ─────────────────────────────

export interface PnrBody {
  recordLocator: string;
  passengerName: string;
  passengerDid?: string;
  contactEmail?: string;
  contactPhone?: string;
  itinerary?: string;
  bookingStatus: string;
  paxCount?: number;
}
export interface PnrView extends PnrBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface CreatePnrInput {
  recordLocator: string;
  passengerName: string;
  passengerDid?: string;
  contactEmail?: string;
  contactPhone?: string;
  itinerary?: string;
  bookingStatus?: string;
  paxCount?: number;
  /** Extra DIDs to grant read-cap (owner always included). */
  recipients?: string[];
}
export interface CreatePnrOutput {
  status: "created" | "rejected";
  uri?: string;
  keyId?: string;
  recordLocator?: string;
  error?: string;
}
export interface GetPnrInput {
  recordLocator: string;
}
export interface GetPnrOutput {
  pnr?: PnrView;
  error?: string;
}
export interface ListPnrsInput {
  bookingStatus?: string;
  limit?: number;
  cursor?: string;
}
export interface ListPnrsOutput {
  items: PnrView[];
  cursor?: string;
  total: number;
}

// ─── e-Ticket (E2E-ENCRYPTED, PII + confidential fare) ──────────────

export interface ETicketBody {
  ticketNo: string;
  recordLocator: string;
  passengerName: string;
  /** decimal currency amount as string (no float). */
  fareAmount: string;
  currency?: string;
  formOfPayment?: string;
  fareBasis?: string;
  issuedAt: string;
}
export interface ETicketView extends ETicketBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface IssueTicketInput {
  ticketNo: string;
  recordLocator: string;
  passengerName: string;
  fareAmount: string;
  currency?: string;
  formOfPayment?: string;
  fareBasis?: string;
  recipients?: string[];
}
export interface IssueTicketOutput {
  status: "issued" | "rejected";
  uri?: string;
  keyId?: string;
  ticketNo?: string;
  error?: string;
}
export interface GetTicketInput {
  ticketNo: string;
}
export interface GetTicketOutput {
  ticket?: ETicketView;
  error?: string;
}

// ─── Ancillary service (E2E-ENCRYPTED, per-pax commercial) ──────────

export interface AncillaryBody {
  ancillaryId: string;
  recordLocator: string;
  serviceType: string;
  /** decimal currency amount as string (no float). */
  price: string;
  currency?: string;
  purchasedAt: string;
}
export interface AncillaryView extends AncillaryBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface AddAncillaryInput {
  ancillaryId: string;
  recordLocator: string;
  serviceType: string;
  price: string;
  currency?: string;
  recipients?: string[];
}
export interface AddAncillaryOutput {
  status: "added" | "rejected";
  uri?: string;
  keyId?: string;
  ancillaryId?: string;
  error?: string;
}

// ─── Reprotection (E2E-ENCRYPTED, per-pax reaccommodation PII) ───────

export interface ReprotectionBody {
  reprotectionId: string;
  recordLocator: string;
  passengerName: string;
  fromFlightNo: string;
  toFlightNo: string;
  reason?: string;
  reprotectedAt: string;
}
export interface ReprotectionView extends ReprotectionBody {
  uri: string;
  sender: string;
  createdAt: string;
}
export interface ReprotectInput {
  reprotectionId: string;
  recordLocator: string;
  passengerName: string;
  fromFlightNo: string;
  toFlightNo: string;
  reason?: string;
  recipients?: string[];
}
export interface ReprotectOutput {
  status: "reprotected" | "rejected";
  uri?: string;
  keyId?: string;
  reprotectionId?: string;
  error?: string;
}

// ─── Coverage rollup ────────────────────────────────────────────────

export interface CoverageInput {
  maxScan?: number;
}
export interface CoverageOutput {
  flightSegmentCount?: number;
  seatAssignmentCount?: number;
  pnrCount?: number;
  eTicketCount?: number;
  ancillaryCount?: number;
  reprotectionCount?: number;
  segmentsByDest?: Record<string, number>;
  truncated?: boolean;
  error?: string;
}

// ─── Validation + helpers ───────────────────────────────────────────

export function isUint(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}
/** Non-empty decimal string (e.g. "1250.50"); no float fields allowed. */
export function isDecimalString(s: unknown): s is string {
  return typeof s === "string" && /^\d+(\.\d+)?$/.test(s);
}
export function segmentDidFor(flightNo: string, depDate: string): string {
  return `${AIR_BOOK_DID_PREFIX}seg:${flightNo.toLowerCase()}:${depDate.toLowerCase()}`;
}
export function seatDidFor(recordLocator: string, flightNo: string, seatNo: string): string {
  return `${AIR_BOOK_DID_PREFIX}seat:${recordLocator.toLowerCase()}:${flightNo.toLowerCase()}:${seatNo.toLowerCase()}`;
}
export function rkeyOf(prefix: string, ...parts: string[]): string {
  const id = parts.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `${prefix}-${id}`;
}
