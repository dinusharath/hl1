import request from "supertest";
import app from "../../src/app";
import { prisma } from "../../src/db/prisma";
import personOne from "../../src/forms/examples/person_one.json";

// Gated: only runs with a real Postgres (see tests/integration/README.md).
const describeDb = process.env.RUN_DB_TESTS ? describe : describe.skip;

describeDb("POST /ingest dedupe (requires DB)", () => {
  beforeAll(async () => {
    await prisma.$executeRaw`TRUNCATE ingested_forms, transformed_forms, outbox RESTART IDENTITY CASCADE`;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("accepts a new form (202) and stores exactly one row", async () => {
    const res = await request(app).post("/ingest").send(personOne);
    expect(res.status).toBe(202);
    const count = await prisma.ingestedForm.count({ where: { sessionId: personOne.session_id } });
    expect(count).toBe(1);
  });

  it("collapses an identical redelivery to one row and bumps duplicate_count", async () => {
    await request(app).post("/ingest").send(personOne); // second, identical delivery
    const row = await prisma.ingestedForm.findUniqueOrThrow({
      where: { sessionId: personOne.session_id },
    });
    expect(row.duplicateCount).toBeGreaterThanOrEqual(1);
  });

  it("flags a same-id / different-data conflict for review", async () => {
    const tampered = { ...personOne, email: "changed@example.com" };
    await request(app).post("/ingest").send(tampered);
    const row = await prisma.ingestedForm.findUniqueOrThrow({
      where: { sessionId: personOne.session_id },
    });
    expect(row.status).toBe("NEEDS_REVIEW");
  });
});
