/** 去掉终端转义序列，只留下可见文本。 */
export function stripAnsi(raw: string): string {
  return raw
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "") // OSC：窗口标题、cwd 上报
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "") // CSI：颜色、光标移动、清屏
    .replace(/\x1b[ -/]*[0-~]/g, "") // 其它转义：ESC = 、ESC (B 、ESC M 、ESC 7 …
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ""); // 控制字符（保留 \n \r \t）
}

/**
 * 一行是否只由「提示符构件」组成：提示符符号、user@host、[user@host:路径]、路径、空白。
 * 真实记录里提示符之间常常没有换行（靠光标定位重画），所以按整行拼起来判，不是逐个词判。
 */
const PROMPT_ONLY_LINE =
  /^(?:\s|[\w.-]+@[\w.-]+|\[[^\]\n]*@[^\]\n]*\]|(?:~|\.{1,2}|\/)[\w./~-]*|[%$#>❯➜»λ])+$/;

/**
 * 剪掉尾部只有提示符重画的噪声，返回可以回放的原始字节流；整份都没内容时返回 ""。
 *
 * 纯终端闲置时 shell 每次窗口尺寸变化都会重画提示符，实测某任务 9KB 记录里大段都是
 * `[apple@M4:~/Downloads]` / `%`（末尾还被光标定位补满空格）。原样回放就是满屏重复提示符，
 * 而新起的 shell 本来就会自己画提示符，所以这些尾部噪声没有价值。前面真正跑过命令、
 * 有过输出的部分照旧保留。
 *
 * 切割点只落在换行字节上：转义序列的字节都在 0x20~0x7E，不含换行，所以不会切坏序列；
 * 末尾补一个属性重置，避免残留颜色影响后面的新输出。
 */
export function trimTrailingPromptNoise(raw: string): string {
  // 保留行尾分隔符，切割后拼回去时不会丢换行
  const lines = raw.split(/(?<=[\r\n])/);
  let lastContent = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const text = stripAnsi(lines[i]).trim();
    if (text !== "" && !PROMPT_ONLY_LINE.test(text)) lastContent = i;
  }
  if (lastContent < 0) return "";
  return `${lines.slice(0, lastContent + 1).join("")}\x1b[0m`;
}
