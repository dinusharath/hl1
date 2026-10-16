/**
 * Integration coverage for the operator-console surface (gated by RUN_DB_TESTS; Postgres on :55432):
 * mappings CRUD + supersede/deactivate, replay, and the drift pipeline (record → list → approve →
 * dismiss), including the idempotency that proves the atomic drift upsert. Hermetic per test.
 */
import request from "supertest";
import app from "../../src/http/app";
import { prisma } from "../../src/db/prisma";
import { recordFromForm } from "../../src/domain/drift/drift.service";

const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

const DRIFTED = {
  session_id: "s-drift",
  name: "Pat Lee",
  primary_email: "p@x.com", // provider renamed `email` → `primary_email`
  gender: "female",
  date_of_birth: "1990-01-01",
  mobile_number: "07123456789",
  address: { address_line_1: "1 A", address_line_2: "B", postcode: "E15 4BZ", country: "UK" },
};

async function seedForm(id: string, status: string): Promise<void> {
  await prisma.ingestedForm.create({
    data: { id, sessionId: id, rawPayload: DRIFTED, payloadHash: `hash-${id}`, status: status as never },
  });
}

describeDb("operator console API (requires DB)", () => {
  beforeEach(() =>
    prisma.$executeRaw`TRUNCATE ingested_forms, transformed_forms, outbox, drift_observations, field_mappings RESTART IDENTITY CASCADE`);
  afterAll(() => prisma.$disconnect());

  describe("mappings", () => {
    it("creates an active v1, supersedes to v2 keeping one active, and deactivates", async () => {
      const c1 = await request(app).post("/mappings").send({ kind: "alias", sourcePath: "work_email", targetPath: "email" });
      expect(c1.status).toBe(201);
      expect(c1.body).toMatchObject({ version: 1, active: true, approvedBy: "operator" });

      const c2 = await request(app).post("/mappings").send({ kind: "alias", sourcePath: "work_email", targetPath: "email" });
      expect(c2.body.version).toBe(2);

      const active = await request(app).get("/mappings");
      const slot = active.body.filter((m: { sourcePath: string }) => m.sourcePath === "work_email");
      expect(slot).toHaveLength(1); // exactly one active per slot
      expect(slot[0].version).toBe(2);

      const off = await request(app).post(`/mappings/${c2.body.id}/deactivate`);
      expect(off.body).toEqual({ ok: true });
      expect((await request(app).get("/mappings")).body).toHaveLength(0);
    });

    it("keeps a different target for the same source as a separate active slot", async () => {
      await request(app).post("/mappings").send({ kind: "alias", sourcePath: "work_email", targetPath: "email" });
      await request(app).post("/mappings").send({ kind: "alias", sourcePath: "work_email", targetPath: "phone_number" });
      expect((await request(app).get("/mappings")).body).toHaveLength(2);
    });

    it("rejects an invalid body with 400", async () => {
      expect((await request(app).post("/mappings").send({ sourcePath: "x" })).status).toBe(400);
    });
  });

  describe("drift recording (atomic upsert)", () => {
    it("counts a form once no matter how many times it is recorded (idempotent)", async () => {
      await recordFromForm({ id: "form-1", rawPayload: DRIFTED });
      await recordFromForm({ id: "form-1", rawPayload: DRIFTED }); // retry — must NOT double count
      const list = await request(app).get("/drift");
      const rename = list.body.find((o: { type: string }) => o.type === "likely_rename");
      expect(rename.count).toBe(1);
      expect(rename.confidence).toBeGreaterThanOrEqual(0.9); // computed suggestion
      expect(rename.suggestion).toMatchObject({ sourcePath: "primary_email", targetPath: "email" });
    });

    it("counts distinct forms for the same drift", async () => {
      await recordFromForm({ id: "form-1", rawPayload: DRIFTED });
      await recordFromForm({ id: "form-2", rawPayload: DRIFTED });
      const rename = (await request(app).get("/drift")).body.find((o: { type: string }) => o.type === "likely_rename");
      expect(rename.count).toBe(2);
    });

    it("exposes no raw PII in the observation shape", async () => {
      await recordFromForm({ id: "form-1", rawPayload: DRIFTED });
      const body = JSON.stringify((await request(app).get("/drift")).body);
      expect(body).not.toContain("p@x.com"); // the email value never surfaces
      expect(body).not.toContain("Pat Lee");
    });

    it("count is NOT capped at the display-sample limit (SAMPLE_CAP=20)", async () => {
      const N = 25; // more than SAMPLE_CAP — this is the case that used to silently cap `count` at 20
      for (let i = 0; i < N; i++) {
        await recordFromForm({ id: `cap-${i}`, rawPayload: DRIFTED });
      }
      const rename = (await request(app).get("/drift")).body.find((o: { type: string }) => o.type === "likely_rename");
      expect(rename.count).toBe(N); // true, uncapped tally
      expect(rename.sampleFormIds).toHaveLength(20); // the display sample stays capped
    });
  });

  describe("drift approve / dismiss", () => {
    it("approve creates a mapping, replays the form, and drops the observation from the queue", async () => {
      await seedForm("form-1", "NEEDS_REVIEW");
      await recordFromForm({ id: "form-1", rawPayload: DRIFTED });
      const obs = (await request(app).get("/drift")).body.find((o: { type: string }) => o.type === "likely_rename");

      const res = await request(app).post(`/drift/${obs.id}/approve`);
      expect(res.body.ok).toBe(true);
      expect(res.body.mappingId).toBeTruthy();

      expect((await request(app).get("/mappings")).body.some((m: { sourcePath: string }) => m.sourcePath === "primary_email")).toBe(true);
      const form = await prisma.ingestedForm.findUniqueOrThrow({ where: { id: "form-1" } });
      expect(form.status).toBe("PENDING"); // replayed
      // Applied observation must not reappear on the actionable queue.
      expect((await request(app).get("/drift")).body.some((o: { id: string }) => o.id === obs.id)).toBe(false);
    });

    it("approve replays EVERY affected form, not just the capped display sample", async () => {
      const N = 25; // more than SAMPLE_CAP — this is the case that used to only ever replay 20
      for (let i = 0; i < N; i++) {
        await seedForm(`cap-${i}`, "NEEDS_REVIEW");
        await recordFromForm({ id: `cap-${i}`, rawPayload: DRIFTED });
      }
      const obs = (await request(app).get("/drift")).body.find((o: { type: string }) => o.type === "likely_rename");
      expect(obs.count).toBe(N);

      const res = await request(app).post(`/drift/${obs.id}/approve`);
      expect(res.body.affected).toBe(N);
      expect(res.body.replayed).toBe(N);

      const stillStuck = await prisma.ingestedForm.count({ where: { status: "NEEDS_REVIEW" } });
      expect(stillStuck).toBe(0); // none left behind
    });

    it("dismiss removes it from the queue", async () => {
      await recordFromForm({ id: "form-1", rawPayload: DRIFTED });
      const obs = (await request(app).get("/drift")).body[0];
      await request(app).post(`/drift/${obs.id}/dismiss`);
      expect((await request(app).get("/drift")).body.some((o: { id: string }) => o.id === obs.id)).toBe(false);
    });
  });

  describe("replay + stats", () => {
    it("replays a FAILED form back to PENDING with attempts reset", async () => {
      await seedForm("form-1", "FAILED");
      await prisma.ingestedForm.update({ where: { id: "form-1" }, data: { attempts: 3 } });
      expect((await request(app).post("/forms/form-1/replay")).body).toEqual({ ok: true });
      const f = await prisma.ingestedForm.findUniqueOrThrow({ where: { id: "form-1" } });
      expect(f.status).toBe("PENDING");
      expect(f.attempts).toBe(0);
    });

    it("reports counts by status", async () => {
      await seedForm("a", "DONE");
      await seedForm("b", "NEEDS_REVIEW");
      await seedForm("c", "FAILED");
      const s = (await request(app).get("/stats")).body;
      expect(s.total).toBe(3);
      expect(s.done).toBe(1);
      expect(s.needsReview).toBe(1);
      expect(s.failed).toBe(1);
    });
  });
});
