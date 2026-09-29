import { describe, expect, it } from "vitest";
import { trimTrailingPromptNoise } from "./screenRecord";

const BRACKET_PROMPT =
  "\x1b[0m\x1b[27m\x1b[24m\x1b[J[\x1b[31mapple\x1b[00m@\x1b[35mM4\x1b[00m:\x1b[34m~/Downloads\x1b[00m]\r\n";
// 末尾这段就是实测记录里的噪声：提示符 + 光标定位补的空格
const PROMPT_NOISE =
  "% \x1b[K\x1b[217C\x1b[00m\x1b[217D\x1b[?1h\x1b=\r\n" +
  BRACKET_PROMPT +
  "%                                                                                                                                                          \r\n";

describe("trimTrailingPromptNoise", () => {
  it("剪掉尾部提示符噪声，保留前面的真实输出", () => {
    const raw = `${BRACKET_PROMPT}% lls\r\n资料  icon.png  打包记录\r\nA  B  C\r\n${PROMPT_NOISE}`;
    const kept = trimTrailingPromptNoise(raw);
    expect(kept).toContain("资料  icon.png  打包记录");
    expect(kept).not.toContain("217C"); // 尾部噪声连同它的光标定位一起没了
    expect(kept.endsWith("\x1b[0m")).toBe(true);
  });

  it("整份只有提示符时返回空串（不必回放）", () => {
    expect(trimTrailingPromptNoise(PROMPT_NOISE)).toBe("");
    expect(trimTrailingPromptNoise(BRACKET_PROMPT + "% % \r\n")).toBe("");
    expect(trimTrailingPromptNoise("")).toBe("");
  });

  it("敲过命令就算有内容，不会把输入的命令剪掉", () => {
    expect(trimTrailingPromptNoise(`${BRACKET_PROMPT}% git status\r\n${PROMPT_NOISE}`)).toContain(
      "git status",
    );
  });

  it("agent 的 TUI 画面不算提示符噪声", () => {
    const tui = "\x1b[2J❯\r\n────────────\r\n⏵⏵ bypass permissions on (shift+tab)\r\n";
    expect(trimTrailingPromptNoise(tui)).toContain("bypass permissions");
  });
});
