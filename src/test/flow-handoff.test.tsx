import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FlowHandoff, handoffTargets } from "../components/running-view/FlowHandoff";
import { I18nProvider } from "../i18n";

afterEach(cleanup);

function renderHandoff(defaultTarget: "claude" | "codex" | "kimi") {
  render(
    <I18nProvider>
      <FlowHandoff
        open
        sourceLabel="Claude Code"
        defaultTarget={defaultTarget}
        onOpenChange={vi.fn()}
        onHandoff={vi.fn(async () => true)}
      />
    </I18nProvider>,
  );
}

describe("流转会话的目标 agent", () => {
  it("三个目标都在：Claude Code / Codex / Kimi", () => {
    expect(handoffTargets.map((target) => target.value)).toEqual(["claude", "codex", "kimi"]);
    expect(handoffTargets.map((target) => target.label)).toEqual(["Claude Code", "Codex", "Kimi"]);
  });

  it("默认目标选 kimi 时，弹窗里显示的就是 Kimi（kimi 是合法目标）", () => {
    renderHandoff("kimi");
    expect(screen.getAllByText("Kimi").length).toBeGreaterThan(0);
  });
});
