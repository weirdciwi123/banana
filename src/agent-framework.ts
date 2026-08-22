import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface AgentFrameworkRuntime {
  run<T>(operation: string, task: () => Promise<T>): Promise<T>;
  isConnected(): Promise<boolean>;
}

export class MicrosoftAgentFrameworkRuntime implements AgentFrameworkRuntime {
  private initPromise?: Promise<boolean>;

  private async ensureInitialized(): Promise<boolean> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          const directEntry = join(process.cwd(), "node_modules", "@microsoft", "agent-framework", "src", "index.ts");
          if (!existsSync(directEntry)) return false;
          await import(pathToFileURL(directEntry).href);
          return true;
        } catch {
          return false;
        }
      })();
    }
    return this.initPromise;
  }

  async isConnected(): Promise<boolean> {
    return this.ensureInitialized();
  }

  async run<T>(_operation: string, task: () => Promise<T>): Promise<T> {
    await this.ensureInitialized();
    return task();
  }
}
