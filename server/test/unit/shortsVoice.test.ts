import { describe, expect, it } from "vitest";
import { toPlainChatText } from "../../src/services/shorts/voice.js";

describe("toPlainChatText", () => {
  it("unwraps bold and inline code", () => {
    expect(toPlainChatText("try a **word clock** with `localStorage`")).toBe(
      "try a word clock with localStorage",
    );
    expect(toPlainChatText("__really__ nice")).toBe("really nice");
  });

  it("turns markdown bullets into readable bullet lines", () => {
    expect(toPlainChatText("- gradient sky\n- filling circles")).toBe(
      "• gradient sky\n• filling circles",
    );
    expect(toPlainChatText("* one\n+ two")).toBe("• one\n• two");
  });

  it("drops heading markers and fence lines", () => {
    expect(toPlainChatText("## ideas\nsome text")).toBe("ideas\nsome text");
    expect(toPlainChatText("```js\nconst a = 1\n```")).toBe("const a = 1");
  });

  it("collapses the blank-line gaps markdown lists leave behind", () => {
    expect(toPlainChatText("a\n\n\n\nb")).toBe("a\n\nb");
  });

  it("leaves plain conversational text untouched", () => {
    const text = "ooh that's a fun one. dark tends to do well, people leave\nthese open all day";
    expect(toPlainChatText(text)).toBe(text);
  });

  it("does not eat lone asterisks or underscores in prose", () => {
    expect(toPlainChatText("2 * 3 is 6")).toBe("2 * 3 is 6");
    expect(toPlainChatText("snake_case_name")).toBe("snake_case_name");
  });

  it("is safe on empty and nullish input", () => {
    expect(toPlainChatText("")).toBe("");
    expect(toPlainChatText(undefined as unknown as string)).toBe("");
  });
});
