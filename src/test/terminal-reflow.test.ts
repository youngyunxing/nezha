import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { SerializeAddon } from "@xterm/addon-serialize";

/**
 * 钉住 xterm 的重排行为：窗口变窄再变宽时，长行要能恢复成一行。
 *
 * 背景：曾怀疑"最上面很窄"是 xterm 重排坏了，于是加过两次"整屏重画"的修补；用这组
 * 对照实测后发现 **xterm 本身没问题**（窄→宽、甚至缩窄期间有 TUI 在别处写入，长行都能
 * 合并回来），于是把那两处修补撤掉了。
 *
 * 注意这个测试**覆盖不到**真正的现象：窗口变小期间 TUI 自己按窄宽度重排界面，那部分
 * 内容滚进终端历史后就是窄的 —— 那是 CLI 的输出，不是缓冲区重排问题，任何终端都一样。
 * 缩窄期间若写入正好落在那一行上，长行当然会被改写，这里刻意写在别的行，保证判据干净。
 */
const LONG = "A".repeat(70);
/** 写在第 5 行：不碰第 1 行那串 A */
const WRITE_ELSEWHERE = "\x1b[5;1Hxx";

function makeTerm(cols: number) {
  const term = new Terminal({ cols, rows: 10, scrollback: 100 });
  const ser = new SerializeAddon();
  term.loadAddon(ser);
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  return { term, ser, write };
}

/** 长文本是否仍然连续（没被重排断成多行） */
function intact(text: string): boolean {
  return text.replace(/\r?\n/g, "").includes(LONG);
}

describe("xterm 重排：窄→宽后长行保持完整", () => {
  it("中间没有任何写入", async () => {
    const { term, ser, write } = makeTerm(40);
    await write(LONG + "\r\n");
    term.resize(20, 10);
    term.resize(40, 10);
    expect(intact(ser.serialize())).toBe(true);
  });

  it("缩窄期间有 TUI 式写入（写在别的行）", async () => {
    const { term, ser, write } = makeTerm(40);
    await write(LONG + "\r\n");
    term.resize(20, 10);
    await write(WRITE_ELSEWHERE);
    term.resize(40, 10);
    expect(intact(ser.serialize())).toBe(true);
  });

  it("缩窄后 serialize → reset → 写回 → 变宽（曾经的重画路径）", async () => {
    const { term, ser, write } = makeTerm(40);
    await write(LONG + "\r\n");
    term.resize(20, 10);
    await write(WRITE_ELSEWHERE);
    const snapshot = ser.serialize();
    term.reset();
    await write(snapshot);
    term.resize(40, 10);
    expect(intact(ser.serialize())).toBe(true);
  });
});
