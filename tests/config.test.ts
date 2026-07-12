import * as fs from "node:fs";
import * as path from "node:path";
import { ConfigService } from "../src/config";

const rulesDir = path.resolve(__dirname, "..", "src", "rules");

describe("ConfigService", () => {
  it("loads valid YAML files on construction", () => {
    const svc = new ConfigService(rulesDir);
    expect(svc).toBeDefined();
  });

  it("getRoutingRules() returns parsed routing map", () => {
    const svc = new ConfigService(rulesDir);
    const rules = svc.getRoutingRules();
    const tech = rules["tech"];
    expect(tech).toBeDefined();
    expect(tech!["instagram"]).toBe(true);
    expect(tech!["douyin"]).toBe(false);
  });

  it("getFormatRules() returns parsed formats map with default key", () => {
    const svc = new ConfigService(rulesDir);
    const formats = svc.getFormatRules();
    const defaults = formats["default"];
    expect(defaults).toBeDefined();
    expect(defaults!["instagram"]).toBe("carousel");
    expect(defaults!["youtube"]).toBe("long_video");
  });

  it("getPriorityConfig() returns weights and max_score", () => {
    const svc = new ConfigService(rulesDir);
    const priority = svc.getPriorityConfig();
    expect(priority.max_score).toBe(100);
    expect(priority.weights["likes"]).toBe(0.2);
    expect(priority.weights["shares"]).toBe(0.3);
  });

  it("onChange callback fires when routing.yaml changes", (done) => {
    const svc = new ConfigService(rulesDir);
    svc.onChange(() => {
      done();
    });
    const filepath = path.join(rulesDir, "routing.yaml");
    const original = fs.readFileSync(filepath, "utf-8");
    fs.writeFileSync(filepath, original);
  }, 5000);

  it("keeps old config on invalid YAML hot-reload", (done) => {
    const svc = new ConfigService(rulesDir);
    const oldRules = svc.getRoutingRules();

    const filepath = path.join(rulesDir, "routing.yaml");
    const original = fs.readFileSync(filepath, "utf-8");

    fs.writeFileSync(filepath, ":::invalid:::");

    setTimeout(() => {
      expect(svc.getRoutingRules()).toEqual(oldRules);
      fs.writeFileSync(filepath, original);
      done();
    }, 500);
  }, 5000);

  it("throws on startup if required YAML file is missing", () => {
    const tmpDir = path.join(__dirname, "tmp_missing");
    fs.mkdirSync(tmpDir, { recursive: true });
    expect(() => new ConfigService(tmpDir)).toThrow("Config file not found");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws on startup if YAML is invalid schema", () => {
    const tmpDir = path.join(__dirname, "tmp_invalid");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "routing.yaml"), "not_a_map: 123");
    fs.writeFileSync(path.join(tmpDir, "formats.yaml"), "default:\n  instagram: carousel");
    fs.writeFileSync(path.join(tmpDir, "priority.yaml"), "weights:\n  likes: 0.2\nmax_score: 100");
    expect(() => new ConfigService(tmpDir)).toThrow("Invalid config");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
