import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import { z } from "zod";

const routingSchema = z.record(z.record(z.boolean()));
const formatSchema = z.record(z.record(z.string()));
const prioritySchema = z.object({
  weights: z.record(z.number()),
  max_score: z.number(),
});

const defaultConfigDir = path.resolve(__dirname, "rules");

export class ConfigService {
  static instance: ConfigService;

  private _routing: z.infer<typeof routingSchema> = {};
  private _formats: z.infer<typeof formatSchema> = {};
  private _priority: z.infer<typeof prioritySchema> = { weights: {}, max_score: 100 };
  private _configDir: string;
  private _listeners: Array<() => void> = [];
  private _watchers: Array<fs.FSWatcher> = [];

  constructor(configDir: string = defaultConfigDir) {
    this._configDir = configDir;
    this._loadAll();
    this._watch();
    ConfigService.instance = this;
  }

  getRoutingRules(): z.infer<typeof routingSchema> {
    return this._routing;
  }

  getFormatRules(): z.infer<typeof formatSchema> {
    return this._formats;
  }

  getPriorityConfig(): z.infer<typeof prioritySchema> {
    return this._priority;
  }

  onChange(callback: () => void): void {
    this._listeners.push(callback);
  }

  close(): void {
    for (const watcher of this._watchers) {
      watcher.close();
    }
    this._watchers = [];
    this._listeners = [];
  }

  private _loadAll(): void {
    this._routing = this._loadAndValidate("routing.yaml", routingSchema);
    this._formats = this._loadAndValidate("formats.yaml", formatSchema);
    this._priority = this._loadAndValidate("priority.yaml", prioritySchema);
  }

  private _loadAndValidate<T>(filename: string, schema: z.ZodSchema<T>): T {
    const filepath = path.join(this._configDir, filename);
    if (!fs.existsSync(filepath)) {
      throw new Error(`Config file not found: ${filepath}`);
    }
    const raw = fs.readFileSync(filepath, "utf-8");
    const parsed = yaml.load(raw);
    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new Error(`Invalid config ${filename}: ${result.error.message}`);
    }
    return result.data;
  }

  private _watch(): void {
    const files = ["routing.yaml", "formats.yaml", "priority.yaml"];
    for (const file of files) {
      const filepath = path.join(this._configDir, file);
      this._watchers.push(fs.watch(filepath, () => {
        try {
          this._loadAll();
          for (const listener of this._listeners) {
            listener();
          }
        } catch (err) {
          console.warn(`[ConfigService] Hot-reload failed for ${file}: ${err}`);
        }
      }));
    }
  }
}
