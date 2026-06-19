module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests", "<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  collectCoverageFrom: ["src/**/*.ts", "!src/index.ts"],
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  forceExit: true,
  detectOpenHandles: true,
};
