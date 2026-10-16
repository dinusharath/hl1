import request from "supertest";
import app from "../src/app";

// DB-free HTTP checks. Liveness and JSON handling don't touch Postgres, so these run anywhere.
// Ingest dedupe + the full pipeline live in tests/integration (gated on a real database).
describe("HTTP app", () => {
  it("GET /health returns 200 ok (liveness, no DB)", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /ingest with malformed JSON returns a clean 400, not a 500", async () => {
    const res = await request(app)
      .post("/ingest")
      .set("Content-Type", "application/json")
      .send("{not valid json");
    expect(res.status).toBe(400);
  });
});
