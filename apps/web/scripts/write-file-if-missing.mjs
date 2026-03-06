import { writeFileSync } from "node:fs";

export function writeFileIfMissing(path, content) {
  try {
    writeFileSync(path, content, { flag: "wx" });
    return true;
  } catch (error) {
    if (error && error.code === "EEXIST") {
      return false;
    }
    throw error;
  }
}
