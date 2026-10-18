import { bulk_removal } from "./util.js";

bulk_removal(
  "node_modules",
  "**/*-out",
  "**/out",
  "**/dist",
  "**/bin",
  "**/obj",
);
