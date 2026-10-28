import { describe, expect, it } from "vite-plus/test";

import { sanitizeCommitSubject, sanitizeProjectBrief } from "./textGenerationUtils.ts";

describe("sanitizeCommitSubject", () => {
  // regression: #19181 truncation split grapheme clusters at the subject limit
  it.each([
    { name: "an emoji", prefixLength: 71, character: "🚀" },
    { name: "an accented character", prefixLength: 71, character: "e\u0301" },
    { name: "a joined emoji", prefixLength: 65, character: "👨‍👩‍👧‍👦" },
  ])("keeps $name intact at the subject limit", ({ prefixLength, character }) => {
    const prefix = "a".repeat(prefixLength);

    expect(sanitizeCommitSubject(`${prefix}${character} more`)).toBe(prefix);
  });
});

describe("sanitizeProjectBrief", () => {
  it("keeps complete sentences when the model exceeds the character limit", () => {
    const prefix = "This project preserves research context. ";
    expect(sanitizeProjectBrief(prefix + "Another sentence ".repeat(40))).toBe(prefix.trim());
  });
  it("caps Unicode code points without splitting surrogate pairs", () => {
    const brief = sanitizeProjectBrief("🚀".repeat(510));
    expect(Array.from(brief)).toHaveLength(500);
    expect(brief).not.toContain("\uFFFD");
    expect(brief.endsWith("…")).toBe(true);
  });
  it("keeps short output and normalizes controls", () => {
    expect(sanitizeProjectBrief(" Mission.\n\u0000 Emphasis. ")).toBe("Mission. Emphasis.");
    expect(sanitizeProjectBrief(" ")).toBe("");
  });
});
