/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	// Only run the TypeScript specs under tests/ — never stale compiled copies in dist/.
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	// Run serially: the DB-backed suites share one Postgres and truncate between tests, so parallel
	// workers would clobber each other. Deterministic and fast enough at this size.
	maxWorkers: 1,
};
