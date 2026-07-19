import { describe, it, expect, beforeEach } from "vitest";
import { MockEtzhayyim } from "@etzhayyim/sdk-mock";
import {
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
} from "../src/index.js";

const OWNER = "did:web:air-book.etzhayyim.com";

describe("air-book kotoba (kotoba-E2E split)", () => {
  let e: any;
  beforeEach(() => {
    e = new MockEtzhayyim({ did: OWNER });
  });

  describe("flightSegment (PLAINTEXT public operational facts)", () => {
    it("registers, dedups, updates status, gets, lists/filters", async () => {
      expect((await registerSegment(e, { flightNo: "JL001", carrier: "JL", origin: "HND", dest: "SFO", depDate: "2026-07-01" })).status).toBe("registered");
      expect((await registerSegment(e, { flightNo: "JL001", carrier: "JL", origin: "HND", dest: "SFO", depDate: "2026-07-01" })).status).toBe("alreadyExists");
      expect((await registerSegment(e, { flightNo: "", carrier: "JL", origin: "HND", dest: "SFO", depDate: "2026-07-01" })).status).toBe("rejected");
      await registerSegment(e, { flightNo: "NH010", carrier: "NH", origin: "NRT", dest: "ORD", depDate: "2026-07-02" });
      expect((await setSegmentStatus(e, { flightNo: "JL001", depDate: "2026-07-01", status: "delayed" })).status).toBe("updated");
      expect((await getSegment(e, { flightNo: "JL001", depDate: "2026-07-01" })).segment?.status).toBe("delayed");
      expect((await listSegments(e)).total).toBe(2);
      expect((await listSegments(e, { dest: "SFO" })).total).toBe(1);
      expect((await listSegments(e, { status: "delayed" })).total).toBe(1);
    });
  });

  describe("seatAssignment (PLAINTEXT, FK → flightSegment)", () => {
    it("enforces FK then assigns, dedups, lists/filters", async () => {
      // FK fails before the segment exists.
      expect((await assignSeat(e, { recordLocator: "ABC123", flightNo: "JL001", depDate: "2026-07-01", seatNo: "12A" })).status).toBe("segmentNotFound");
      await registerSegment(e, { flightNo: "JL001", carrier: "JL", origin: "HND", dest: "SFO", depDate: "2026-07-01" });
      expect((await assignSeat(e, { recordLocator: "ABC123", flightNo: "JL001", depDate: "2026-07-01", seatNo: "12A", cabin: "Y" })).status).toBe("assigned");
      expect((await assignSeat(e, { recordLocator: "ABC123", flightNo: "JL001", depDate: "2026-07-01", seatNo: "12A" })).status).toBe("alreadyExists");
      await assignSeat(e, { recordLocator: "DEF456", flightNo: "JL001", depDate: "2026-07-01", seatNo: "14C" });
      expect((await listSeatAssignments(e, { flightNo: "JL001" })).total).toBe(2);
      expect((await listSeatAssignments(e, { recordLocator: "ABC123" })).total).toBe(1);
    });
  });

  describe("pnr (E2E-ENCRYPTED passenger PII)", () => {
    it("seals via encryptedWrite, round-trips via encryptedRead, validates", async () => {
      const ok = await createPnr(e, { recordLocator: "ABC123", passengerName: "Yamada Taro", passengerDid: "did:web:pax.example", contactEmail: "t@example.com", bookingStatus: "confirmed", paxCount: 2 });
      expect(ok.status).toBe("created");
      expect(ok.keyId).toBeTruthy();
      expect((await createPnr(e, { recordLocator: "X", passengerName: "" })).status).toBe("rejected");
      expect((await createPnr(e, { recordLocator: "X", passengerName: "Y", paxCount: -1 })).status).toBe("rejected");
      const got = await getPnr(e, { recordLocator: "ABC123" });
      expect(got.pnr?.passengerName).toBe("Yamada Taro");
      expect(got.pnr?.contactEmail).toBe("t@example.com");
      await createPnr(e, { recordLocator: "DEF456", passengerName: "Suzuki Hanako", bookingStatus: "held" });
      expect((await listPnrs(e)).total).toBe(2);
      expect((await listPnrs(e, { bookingStatus: "confirmed" })).total).toBe(1);
    });

    it("enforces read-cap: a non-recipient DID cannot decrypt the PNR", async () => {
      await createPnr(e, { recordLocator: "ABC123", passengerName: "Yamada Taro" });
      const outsider: any = new MockEtzhayyim({ did: "did:web:outsider.example" });
      expect((await listPnrs(outsider)).total).toBe(0);
    });

    it("grants read-cap to an explicit recipient", async () => {
      const partner = "did:web:partner.example";
      const r = await createPnr(e, { recordLocator: "ABC123", passengerName: "Yamada Taro", recipients: [partner] });
      expect(r.status).toBe("created");
      expect((await listPnrs(e)).total).toBe(1);
    });
  });

  describe("eTicket (E2E-ENCRYPTED PII + confidential fare)", () => {
    it("issues with decimal-string fare, round-trips, validates float-free", async () => {
      const ok = await issueTicket(e, { ticketNo: "131-1234567890", recordLocator: "ABC123", passengerName: "Yamada Taro", fareAmount: "98500.00", currency: "JPY", formOfPayment: "card", fareBasis: "YOW" });
      expect(ok.status).toBe("issued");
      expect(ok.keyId).toBeTruthy();
      // float / malformed amount rejected (AT-Lexicon no-float → decimal STRING only).
      expect((await issueTicket(e, { ticketNo: "t2", recordLocator: "r", passengerName: "p", fareAmount: "abc" })).status).toBe("rejected");
      const got = await getTicket(e, { ticketNo: "131-1234567890" });
      expect(got.ticket?.fareAmount).toBe("98500.00");
      expect(got.ticket?.formOfPayment).toBe("card");
    });
  });

  describe("ancillary + reprotection (E2E-ENCRYPTED per-pax)", () => {
    it("adds an ancillary and reprotects a passenger", async () => {
      expect((await addAncillary(e, { ancillaryId: "anc-1", recordLocator: "ABC123", serviceType: "extra-baggage", price: "5000.00", currency: "JPY" })).status).toBe("added");
      expect((await addAncillary(e, { ancillaryId: "anc-2", recordLocator: "ABC123", serviceType: "lounge", price: "bad" })).status).toBe("rejected");
      expect((await reprotectPassenger(e, { reprotectionId: "rpt-1", recordLocator: "ABC123", passengerName: "Yamada Taro", fromFlightNo: "JL001", toFlightNo: "JL003", reason: "irrops" })).status).toBe("reprotected");
      expect((await reprotectPassenger(e, { reprotectionId: "rpt-2", recordLocator: "ABC123", passengerName: "", fromFlightNo: "JL001", toFlightNo: "JL003" })).status).toBe("rejected");
    });
  });

  describe("coverage rollup", () => {
    it("counts plaintext segments/seats + E2E pnr/ticket/ancillary/reprotection", async () => {
      await registerSegment(e, { flightNo: "JL001", carrier: "JL", origin: "HND", dest: "SFO", depDate: "2026-07-01" });
      await registerSegment(e, { flightNo: "JL003", carrier: "JL", origin: "HND", dest: "SFO", depDate: "2026-07-03" });
      await assignSeat(e, { recordLocator: "ABC123", flightNo: "JL001", depDate: "2026-07-01", seatNo: "12A" });
      await createPnr(e, { recordLocator: "ABC123", passengerName: "Yamada Taro" });
      await issueTicket(e, { ticketNo: "t1", recordLocator: "ABC123", passengerName: "Yamada Taro", fareAmount: "98500.00" });
      await addAncillary(e, { ancillaryId: "anc-1", recordLocator: "ABC123", serviceType: "extra-baggage", price: "5000.00" });
      await reprotectPassenger(e, { reprotectionId: "rpt-1", recordLocator: "ABC123", passengerName: "Yamada Taro", fromFlightNo: "JL001", toFlightNo: "JL003" });
      const cov = await coverage(e);
      expect(cov.flightSegmentCount).toBe(2);
      expect(cov.seatAssignmentCount).toBe(1);
      expect(cov.pnrCount).toBe(1);
      expect(cov.eTicketCount).toBe(1);
      expect(cov.ancillaryCount).toBe(1);
      expect(cov.reprotectionCount).toBe(1);
      expect(cov.segmentsByDest?.SFO).toBe(2);
    });
  });
});
