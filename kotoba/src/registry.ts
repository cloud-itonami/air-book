/**
 * air-book kotoba — kotoba-E2E registry.
 *
 * Plaintext path (flightSegment, seatAssignment): sdk.write / sdk.read — public
 * operational flight facts. FK seatAssignment → flightSegment via exists().
 * E2E path (pnr, eTicket, ancillary, reprotection): sdk.encryptedWrite /
 * sdk.encryptedRead — PII + confidential commercial terms sealed in the kotoba
 * envelope (ADR-2605181100), read-cap = owner DID + explicit recipients.
 *
 * STAYS etzhayyim (consumed via consent-capability) — IATA-BSP fiat-clearing
 * settlement EXECUTION. The ticket/fare ledger DATA is migrated here as E2E
 * eTicket records; only the fiat clearing CALL stays etzhayyim.
 */

import type { Etzhayyim } from "@etzhayyim/sdk";
import {
  ANCILLARY_INNER_TYPE,
  ETICKET_INNER_TYPE,
  FLIGHT_SEGMENT_COLLECTION,
  PNR_INNER_TYPE,
  REPROTECTION_INNER_TYPE,
  SEAT_ASSIGNMENT_COLLECTION,
  isDecimalString,
  isUint,
  rkeyOf,
  seatDidFor,
  segmentDidFor,
  type AddAncillaryInput,
  type AddAncillaryOutput,
  type AncillaryBody,
  type AncillaryView,
  type AssignSeatInput,
  type AssignSeatOutput,
  type CoverageInput,
  type CoverageOutput,
  type CreatePnrInput,
  type CreatePnrOutput,
  type ETicketBody,
  type ETicketView,
  type FlightSegmentRecord,
  type FlightSegmentView,
  type GetPnrInput,
  type GetPnrOutput,
  type GetSegmentInput,
  type GetSegmentOutput,
  type GetTicketInput,
  type GetTicketOutput,
  type IssueTicketInput,
  type IssueTicketOutput,
  type ListPnrsInput,
  type ListPnrsOutput,
  type ListSeatAssignmentsInput,
  type ListSeatAssignmentsOutput,
  type ListSegmentsInput,
  type ListSegmentsOutput,
  type PnrBody,
  type PnrView,
  type RegisterSegmentInput,
  type RegisterSegmentOutput,
  type ReprotectInput,
  type ReprotectOutput,
  type ReprotectionBody,
  type ReprotectionView,
  type SeatAssignmentRecord,
  type SeatAssignmentView,
  type SetSegmentStatusInput,
  type SetSegmentStatusOutput,
} from "./types.js";

const PAGE_LIMIT = 100;
const DEFAULT_MAX_SCAN = 10_000;

// ─── Plaintext FK helper (exists via read; mock has no exists()) ─────

async function segmentExists(e: Etzhayyim, flightNo: string, depDate: string): Promise<boolean> {
  const rkey = rkeyOf("seg", flightNo, depDate);
  const resp = await e
    .read<FlightSegmentRecord>({ collection: FLIGHT_SEGMENT_COLLECTION, rkey })
    .catch(() => ({ records: [] as Array<{ uri: string; value: FlightSegmentRecord }> }));
  return Boolean(resp.records[0]?.value);
}

// ─── Flight segment anchor (PLAINTEXT) ──────────────────────────────

export async function registerSegment(e: Etzhayyim, input: RegisterSegmentInput): Promise<RegisterSegmentOutput> {
  if (!input.flightNo || !input.carrier || !input.origin || !input.dest || !input.depDate) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const rkey = rkeyOf("seg", input.flightNo, input.depDate);
  const existing = await e.read<FlightSegmentRecord>({ collection: FLIGHT_SEGMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", segmentUri: existing.records[0].uri, did: existing.records[0].value.did, flightNo: input.flightNo };
  }
  const now = new Date().toISOString();
  const did = segmentDidFor(input.flightNo, input.depDate);
  const record: FlightSegmentRecord = {
    did,
    flightNo: input.flightNo,
    carrier: input.carrier,
    origin: input.origin,
    dest: input.dest,
    depDate: input.depDate,
    cabin: input.cabin,
    status: input.status ?? "scheduled",
    createdAt: now,
  };
  const receipt = await e.write({ collection: FLIGHT_SEGMENT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "registered", segmentUri: receipt.uri, did, flightNo: input.flightNo };
}

export async function setSegmentStatus(e: Etzhayyim, input: SetSegmentStatusInput): Promise<SetSegmentStatusOutput> {
  if (!input.flightNo || !input.depDate || !input.status) return { status: "rejected", error: "missingRequiredFields" };
  const rkey = rkeyOf("seg", input.flightNo, input.depDate);
  const existing = await e.read<FlightSegmentRecord>({ collection: FLIGHT_SEGMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const prior = existing.records[0]?.value;
  if (!prior) return { status: "rejected", error: "segmentNotFound" };
  const updated: FlightSegmentRecord = { ...prior, status: input.status };
  const receipt = await e.write({ collection: FLIGHT_SEGMENT_COLLECTION, record: updated as unknown as Record<string, unknown>, rkey });
  return { status: "updated", segmentUri: receipt.uri, flightNo: input.flightNo };
}

export async function getSegment(e: Etzhayyim, input: GetSegmentInput): Promise<GetSegmentOutput> {
  if (!input.flightNo || !input.depDate) return { error: "invalidKey" };
  const rkey = rkeyOf("seg", input.flightNo, input.depDate);
  const resp = await e.read<FlightSegmentRecord>({ collection: FLIGHT_SEGMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  const r = resp.records[0];
  if (!r?.value) return { error: "notFound" };
  return { segment: { ...r.value, segmentUri: r.uri } };
}

export async function listSegments(e: Etzhayyim, input: ListSegmentsInput = {}): Promise<ListSegmentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<FlightSegmentRecord>({ collection: FLIGHT_SEGMENT_COLLECTION, cursor: input.cursor, limit });
  const items: FlightSegmentView[] = resp.records
    .filter((r) => (!input.dest || r.value.dest === input.dest) && (!input.status || r.value.status === input.status))
    .map((r) => ({ ...r.value, segmentUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── Seat assignment (PLAINTEXT, FK → flightSegment) ─────────────────

export async function assignSeat(e: Etzhayyim, input: AssignSeatInput): Promise<AssignSeatOutput> {
  if (!input.recordLocator || !input.flightNo || !input.depDate || !input.seatNo) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  if (!(await segmentExists(e, input.flightNo, input.depDate))) {
    return { status: "segmentNotFound", error: "segmentNotFound" };
  }
  const rkey = rkeyOf("seat", input.recordLocator, input.flightNo, input.seatNo);
  const existing = await e.read<SeatAssignmentRecord>({ collection: SEAT_ASSIGNMENT_COLLECTION, rkey }).catch(() => ({ records: [] }));
  if (existing.records[0]?.value) {
    return { status: "alreadyExists", assignmentUri: existing.records[0].uri, did: existing.records[0].value.did };
  }
  const now = new Date().toISOString();
  const did = seatDidFor(input.recordLocator, input.flightNo, input.seatNo);
  const record: SeatAssignmentRecord = {
    did,
    recordLocator: input.recordLocator,
    flightNo: input.flightNo,
    depDate: input.depDate,
    seatNo: input.seatNo,
    cabin: input.cabin,
    createdAt: now,
  };
  const receipt = await e.write({ collection: SEAT_ASSIGNMENT_COLLECTION, record: record as unknown as Record<string, unknown>, rkey });
  return { status: "assigned", assignmentUri: receipt.uri, did };
}

export async function listSeatAssignments(e: Etzhayyim, input: ListSeatAssignmentsInput = {}): Promise<ListSeatAssignmentsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const resp = await e.read<SeatAssignmentRecord>({ collection: SEAT_ASSIGNMENT_COLLECTION, cursor: input.cursor, limit });
  const items: SeatAssignmentView[] = resp.records
    .filter((r) => (!input.flightNo || r.value.flightNo === input.flightNo) && (!input.recordLocator || r.value.recordLocator === input.recordLocator))
    .map((r) => ({ ...r.value, assignmentUri: r.uri }));
  return { items, cursor: resp.cursor, total: items.length };
}

// ─── PNR (E2E-ENCRYPTED, passenger PII) ─────────────────────────────

export async function createPnr(e: Etzhayyim, input: CreatePnrInput): Promise<CreatePnrOutput> {
  if (!input.recordLocator || !input.passengerName) return { status: "rejected", error: "missingRequiredFields" };
  if (input.paxCount !== undefined && !isUint(input.paxCount)) return { status: "rejected", error: "invalidPaxCount" };
  const body: PnrBody = {
    recordLocator: input.recordLocator,
    passengerName: input.passengerName,
    passengerDid: input.passengerDid,
    contactEmail: input.contactEmail,
    contactPhone: input.contactPhone,
    itinerary: input.itinerary,
    bookingStatus: input.bookingStatus ?? "held",
    paxCount: input.paxCount,
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: PNR_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("pnr", input.recordLocator),
  });
  return { status: "created", uri: receipt.uri, keyId: receipt.keyId, recordLocator: input.recordLocator };
}

async function scanPnrs(e: Etzhayyim, maxScan: number): Promise<PnrView[]> {
  const out: PnrView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<PnrBody>({ innerType: PNR_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function listPnrs(e: Etzhayyim, input: ListPnrsInput = {}): Promise<ListPnrsOutput> {
  const limit = Math.min(input.limit ?? 50, 200);
  const all = await scanPnrs(e, DEFAULT_MAX_SCAN);
  const filtered = all.filter((p) => !input.bookingStatus || p.bookingStatus === input.bookingStatus);
  return { items: filtered.slice(0, limit), total: filtered.length };
}

export async function getPnr(e: Etzhayyim, input: GetPnrInput): Promise<GetPnrOutput> {
  if (!input.recordLocator) return { error: "invalidRecordLocator" };
  const all = await scanPnrs(e, DEFAULT_MAX_SCAN);
  const found = all.find((p) => p.recordLocator === input.recordLocator);
  if (!found) return { error: "notFound" };
  return { pnr: found };
}

// ─── e-Ticket (E2E-ENCRYPTED, PII + confidential fare) ──────────────

export async function issueTicket(e: Etzhayyim, input: IssueTicketInput): Promise<IssueTicketOutput> {
  if (!input.ticketNo || !input.recordLocator || !input.passengerName) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.fareAmount)) return { status: "rejected", error: "invalidFareAmount" };
  const body: ETicketBody = {
    ticketNo: input.ticketNo,
    recordLocator: input.recordLocator,
    passengerName: input.passengerName,
    fareAmount: input.fareAmount,
    currency: input.currency,
    formOfPayment: input.formOfPayment,
    fareBasis: input.fareBasis,
    issuedAt: new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: ETICKET_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("tkt", input.ticketNo),
  });
  return { status: "issued", uri: receipt.uri, keyId: receipt.keyId, ticketNo: input.ticketNo };
}

async function scanTickets(e: Etzhayyim, maxScan: number): Promise<ETicketView[]> {
  const out: ETicketView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ETicketBody>({ innerType: ETICKET_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

export async function getTicket(e: Etzhayyim, input: GetTicketInput): Promise<GetTicketOutput> {
  if (!input.ticketNo) return { error: "invalidTicketNo" };
  const all = await scanTickets(e, DEFAULT_MAX_SCAN);
  const found = all.find((t) => t.ticketNo === input.ticketNo);
  if (!found) return { error: "notFound" };
  return { ticket: found };
}

// ─── Ancillary service (E2E-ENCRYPTED, per-pax commercial) ──────────

export async function addAncillary(e: Etzhayyim, input: AddAncillaryInput): Promise<AddAncillaryOutput> {
  if (!input.ancillaryId || !input.recordLocator || !input.serviceType) return { status: "rejected", error: "missingRequiredFields" };
  if (!isDecimalString(input.price)) return { status: "rejected", error: "invalidPrice" };
  const body: AncillaryBody = {
    ancillaryId: input.ancillaryId,
    recordLocator: input.recordLocator,
    serviceType: input.serviceType,
    price: input.price,
    currency: input.currency,
    purchasedAt: new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: ANCILLARY_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("anc", input.ancillaryId),
  });
  return { status: "added", uri: receipt.uri, keyId: receipt.keyId, ancillaryId: input.ancillaryId };
}

async function scanAncillaries(e: Etzhayyim, maxScan: number): Promise<AncillaryView[]> {
  const out: AncillaryView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<AncillaryBody>({ innerType: ANCILLARY_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Reprotection (E2E-ENCRYPTED, per-pax reaccommodation PII) ───────

export async function reprotectPassenger(e: Etzhayyim, input: ReprotectInput): Promise<ReprotectOutput> {
  if (!input.reprotectionId || !input.recordLocator || !input.passengerName || !input.fromFlightNo || !input.toFlightNo) {
    return { status: "rejected", error: "missingRequiredFields" };
  }
  const body: ReprotectionBody = {
    reprotectionId: input.reprotectionId,
    recordLocator: input.recordLocator,
    passengerName: input.passengerName,
    fromFlightNo: input.fromFlightNo,
    toFlightNo: input.toFlightNo,
    reason: input.reason,
    reprotectedAt: new Date().toISOString(),
  };
  const receipt = await e.encryptedWrite<Record<string, unknown>>({
    innerType: REPROTECTION_INNER_TYPE,
    record: body as unknown as Record<string, unknown>,
    recipients: input.recipients ?? [],
    rkey: rkeyOf("rpt", input.reprotectionId),
  });
  return { status: "reprotected", uri: receipt.uri, keyId: receipt.keyId, reprotectionId: input.reprotectionId };
}

async function scanReprotections(e: Etzhayyim, maxScan: number): Promise<ReprotectionView[]> {
  const out: ReprotectionView[] = [];
  let cursor: string | undefined;
  while (out.length < maxScan) {
    const page = await e.encryptedRead<ReprotectionBody>({ innerType: REPROTECTION_INNER_TYPE, cursor, limit: PAGE_LIMIT });
    for (const r of page.records) out.push({ ...r.value, uri: r.uri, sender: r.sender, createdAt: r.createdAt });
    if (!page.cursor || page.records.length === 0) break;
    cursor = page.cursor;
  }
  return out;
}

// ─── Coverage rollup (plaintext + E2E countAll) ─────────────────────

export async function coverage(e: Etzhayyim, input: CoverageInput = {}): Promise<CoverageOutput> {
  const maxScan = Math.min(input.maxScan ?? DEFAULT_MAX_SCAN, DEFAULT_MAX_SCAN);
  const segmentsByDest: Record<string, number> = {};
  let flightSegmentCount = 0;
  let segCursor: string | undefined;
  while (flightSegmentCount < maxScan) {
    const page = await e.read<FlightSegmentRecord>({ collection: FLIGHT_SEGMENT_COLLECTION, cursor: segCursor, limit: PAGE_LIMIT });
    for (const r of page.records) {
      segmentsByDest[r.value.dest] = (segmentsByDest[r.value.dest] ?? 0) + 1;
      flightSegmentCount += 1;
    }
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    segCursor = page.cursor;
  }
  let seatAssignmentCount = 0;
  let seatCursor: string | undefined;
  while (seatAssignmentCount < maxScan) {
    const page = await e.read<SeatAssignmentRecord>({ collection: SEAT_ASSIGNMENT_COLLECTION, cursor: seatCursor, limit: PAGE_LIMIT });
    seatAssignmentCount += page.records.length;
    if (!page.cursor || page.records.length < PAGE_LIMIT) break;
    seatCursor = page.cursor;
  }
  const pnrCount = (await scanPnrs(e, maxScan)).length;
  const eTicketCount = (await scanTickets(e, maxScan)).length;
  const ancillaryCount = (await scanAncillaries(e, maxScan)).length;
  const reprotectionCount = (await scanReprotections(e, maxScan)).length;
  return {
    flightSegmentCount,
    seatAssignmentCount,
    pnrCount,
    eTicketCount,
    ancillaryCount,
    reprotectionCount,
    segmentsByDest,
    truncated:
      flightSegmentCount >= maxScan ||
      seatAssignmentCount >= maxScan ||
      pnrCount >= maxScan ||
      eTicketCount >= maxScan ||
      ancillaryCount >= maxScan ||
      reprotectionCount >= maxScan,
  };
}
