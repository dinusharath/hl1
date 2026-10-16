// The Express app now lives in src/http/app.ts. This thin re-export keeps the original
// import path (`src/app`) working for existing tests and tooling.
export { default } from "./http/app";
