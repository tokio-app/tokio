import { Provider } from "@/common/types";
import { formatError } from "@/common/util";
import { cleanText } from "@/helper/chat";
import Logger from "@/logger";
import { promises as fs } from "fs";
import { z } from "zod";

export abstract class Service {
  protected _logFile: string;
  public abstract setLogFile(logFile: string): void;
}

interface IProvider {
  setKey(key: string): void;
}

export class ProviderService<T extends IProvider>
  extends Service
  implements IProvider
{
  protected _current:
    { name: string; provider: T | null; key: string } | undefined;
  protected _providerPool: Map<string, T> | undefined;

  constructor() {
    super();
    this._current = {
      name: "",
      key: "",
      provider: null,
    };
    this._providerPool = new Map();
  }

  public addProvider(name: string, provider: T, start?: boolean) {
    if (!this._validProvider(provider)) return;
    this._providerPool?.set(name, provider);
    if (start) {
      this.setProvider(name);
    }
  }

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  public setKey(key: string): void {
    if (this._current?.provider) this._current.provider.setKey(key);
  }

  public setProvider(name: string, key?: string) {
    const provider = this._providerPool?.get(name);
    if (!provider) return;
    this._current = { name, provider, key: key || "" };
    this.setKey(key || "");
  }

  public getProviders(): Provider[] {
    const providers = this._providerPool?.keys().toArray() || [];
    return providers.map((s) => ({
      name: s,
      active: s == this._current?.name,
      key: this._current?.key || "",
    }));
  }

  // NOTE: MUST Override this in the child class!
  protected _validProvider(_provider: T) {
    return false;
  }
}

export abstract class BaseFileManagerService extends Service {
  private _writeLocks: Map<string, Promise<unknown>> = new Map();

  protected abstract fileType: string;
  protected abstract serialize(data: unknown): string;
  protected abstract deserialize(content: string): unknown;

  public setLogFile(logFile: string) {
    this._logFile = logFile;
  }

  public async saveArbitraryFile<T>(
    filePath: string,
    data: T,
  ): Promise<boolean> {
    const tempPath = `${filePath}.tmp`;
    try {
      await fs.writeFile(tempPath, this.serialize(data), "utf-8");
      await fs.rename(tempPath, filePath);

      return true;
    } catch (error) {
      this._logError(
        `Unable to save ${this.fileType} file`,
        filePath,
        formatError(error),
        error,
      );
      await fs.unlink(tempPath).catch(() => {});
      return false;
    }
  }

  public async saveFile<T>(
    filePath: string,
    schema: z.ZodType<T>,
    data: T,
  ): Promise<boolean> {
    if (!this._validate(schema, data, filePath, "saving")) return false;
    return this.saveArbitraryFile(filePath, data);
  }

  public async loadFile<T>(
    filePath: string,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    const data = await this.loadArbitraryFile(filePath);
    if (data === null) return null;
    return this._validate(schema, data, filePath, "loading");
  }

  public async loadArbitraryFile<T>(filePath: string): Promise<T | null> {
    try {
      const fileContent = await fs.readFile(filePath, "utf-8");
      return this.deserialize(fileContent) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;

      const isSyntax =
        error instanceof SyntaxError ||
        (error as Error).name === "YAMLParseError";
      this._logError(
        isSyntax
          ? `Malformed ${this.fileType.toUpperCase()} in file`
          : `Unable to load ${this.fileType} file`,
        filePath,
        formatError(error),
        error,
      );
      return null;
    }
  }

  public async updateFile<T>(
    filePath: string,
    schema: z.ZodType<T>,
    updates: Partial<T>,
  ): Promise<{ success: boolean; data: T | null }> {
    const currentLock = this._writeLocks.get(filePath) || Promise.resolve();

    const updatePromise = currentLock
      .catch(() => {})
      .then(async () => {
        const existingData = await this.loadFile(filePath, schema);
        if (!existingData) {
          this._logError(
            `Unable to update ${this.fileType} file`,
            filePath,
            "File does not exist or is invalid.",
          );
          return { success: false, data: null };
        }

        const mergedData = this._deepMerge(existingData, updates);
        const saveSuccess = await this.saveFile(filePath, schema, mergedData);

        return { success: saveSuccess, data: saveSuccess ? mergedData : null };
      });

    this._writeLocks.set(filePath, updatePromise);

    try {
      return await updatePromise;
    } finally {
      if (this._writeLocks.get(filePath) === updatePromise) {
        this._writeLocks.delete(filePath);
      }
    }
  }

  private _logError(
    action: string,
    filePath: string,
    details: string,
    error?: unknown,
  ) {
    Logger.error(
      `<System> ${action} ${filePath} -- ${details}`,
      this._logFile,
      error,
    );
  }

  private _validate<T>(
    schema: z.ZodType<T>,
    data: unknown,
    filePath: string,
    context: string,
  ): T | null {
    const validation = schema.safeParse(data);
    if (!validation.success) {
      this._logError(
        `Schema validation failed while ${context} ${this.fileType} file`,
        filePath,
        cleanText(z.prettifyError(validation.error)),
      );
      return null;
    }
    return validation.data;
  }

  private _deepMerge<T>(target: T, source?: Partial<T>): T {
    if (target === source) return target;
    const isObject = (item: unknown): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object" && !Array.isArray(item));

    if (!isObject(target) || !isObject(source)) {
      return (source !== undefined ? source : target) as T;
    }

    const output = { ...target } as Record<string, unknown>;
    const sourceObj = source as Record<string, unknown>;

    for (const key of Object.keys(sourceObj)) {
      const targetVal = output[key];
      const sourceVal = sourceObj[key];

      if (sourceVal === undefined || sourceVal === targetVal) {
        continue;
      }

      if (isObject(targetVal) && isObject(sourceVal)) {
        output[key] = this._deepMerge(targetVal, sourceVal);
      } else {
        output[key] = sourceVal;
      }
    }

    return output as T;
  }
}
