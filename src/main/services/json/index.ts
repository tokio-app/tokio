import { BaseFileManagerService } from "../shared";

export class JSONManagerService extends BaseFileManagerService {
  protected fileType = "json";

  protected serialize(data: unknown): string {
    return JSON.stringify(data, null, 2);
  }

  // Without the BOM some editors write first, which JSON.parse refuses
  protected deserialize(content: string): unknown {
    return JSON.parse(content.replace(/^\uFEFF/, ""));
  }
}
