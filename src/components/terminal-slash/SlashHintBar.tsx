import s from "../../styles";
import type { SlashHintMatch } from "../../slashHint";

/** 列表模式里每条的说明只留这么长 —— 一行塞四条，长了就撑爆提示条 */
const LIST_DESC_CHARS = 10;

function shortDesc(zh: string): string {
  return zh.length > LIST_DESC_CHARS ? `${zh.slice(0, LIST_DESC_CHARS)}…` : zh;
}

/**
 * 终端底部那条斜杠命令提示。
 *
 * 纯展示，**不接管键盘、不做自动补全** —— CLI 自己有补全菜单，两边一起改输入会把
 * 用户敲的字搞乱。这里只回答「这个命令是干什么的 / 怎么用」。
 * 命令名敲全了给「用法 + 说明」，还差几个字母就给候选的名字 + 一句话。
 */
export function SlashHintBar({ hint }: { hint: SlashHintMatch }) {
  const exact = hint.exact;
  return (
    <div style={s.slashHintBar}>
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
            <span style={s.slashHintDesc}>{shortDesc(c.zh)}</span>
          </span>
        ))
      )}
    </div>
  );
}
