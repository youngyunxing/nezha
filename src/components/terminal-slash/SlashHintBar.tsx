import s from "../../styles";
import type { SlashHintMatch } from "../../slashHint";

/**
 * 终端底部那条斜杠命令提示。
 *
 * 位置跟着光标走（浮在光标所在行的上一行），所以在哪儿打字都看得见。
 * 说明文字不截断，一行放不下就换行 —— 宁可长高，不要看不全。
 * 纯展示，**不接管键盘、不做自动补全** —— CLI 自己有补全菜单，两边一起改输入会把
 * 用户敲的字搞乱。这里只回答「这个命令是干什么的 / 怎么用」。
 * 命令名敲全了给「用法 + 说明」，还差几个字母就给候选的名字 + 一句话。
 */
export function SlashHintBar({
  hint,
  bottom,
}: {
  hint: SlashHintMatch;
  /** 贴着光标那一行的上边缘；量不出来就不传，用样式里的兜底位置 */
  bottom?: number;
}) {
  const exact = hint.exact;
  return (
    <div style={bottom === undefined ? s.slashHintBar : { ...s.slashHintBar, bottom }}>
      <code style={s.slashHintToken}>{hint.token}</code>
      {exact ? (
        <>
          {/* 敲的是别名（比如 /quit）时补一句本名，免得和 CLI 补全出来的名字对不上 */}
          {exact.name !== hint.token.slice(1) && (
            <code style={s.slashHintCmd}>→ /{exact.name}</code>
          )}
          {exact.usage && <code style={s.slashHintUsage}>{exact.usage}</code>}
          <span style={s.slashHintDesc}>{exact.zh}</span>
        </>
      ) : (
        hint.suggestions.map((c) => (
          <span key={c.name} style={s.slashHintItem}>
            <code style={s.slashHintCmd}>/{c.name}</code>
            <span style={s.slashHintDesc}>{c.zh}</span>
          </span>
        ))
      )}
    </div>
  );
}
