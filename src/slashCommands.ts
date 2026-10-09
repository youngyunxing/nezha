import type { AgentType } from "./types";

/**
 * 终端里敲斜杠命令时那条中文提示的对照表。
 *
 * 表是从 Claude Code CLI 自己内嵌的命令定义里扒出来的（`name` / `description` /
 * `argumentHint` 都在二进制里，用脚本扫一遍就有，不用手抄），中文说明是后配的 ——
 * CLI 不提供中文，也没有任何命令能把清单吐出来，所以**升级 CLI 后这张表要重扫**
 * （做法记在 FORK.md）。参数占位保留 CLI 原样，只把描述性占位翻成中文。
 *
 * ⚠️ **判据是「CLI 的补全菜单里真有的」**，扫出来还得拿真 CLI 对一遍（做法在 FORK.md）。
 * 两条已经踩过的坑：
 *   1. 别把 `jo({name:...})` 那套收进来 —— 那是 **skill 注册表**（bundled skill），
 *      不是斜杠命令。`/explain-usage`、`/doctor` 就是这么混进来、敲了报 Unknown command 的。
 *   2. 二进制里注册了 ≠ 这台机器上能用。`/voice`、`/teleport`、`/install*` 这些按套餐 /
 *      平台 / 云功能开关，本地菜单里根本不出现，敲了一样报 Unknown command。
 *      宁可少给提示，也别让人敲一条不存在的命令。
 */
export interface SlashCommand {
  /** 不带斜杠的命令名 */
  name: string;
  /** 用法里的参数占位（CLI 的 argumentHint），没参数就是空串 */
  usage: string;
  /** 中文说明 —— 提示条上真正显示的那句 */
  zh: string;
  /** CLI 认的别名（比如 /quit 就是 /exit）；没有别名就不写这一项 */
  aliases?: readonly string[];
}

const REST: readonly SlashCommand[] = [
  { name: "add-dir", usage: "<路径>", zh: "把一个新目录加进本次会话的工作范围" },
  { name: "autocompact", usage: "[auto|<token 数>]", zh: "设置上下文多满时自动摘要压缩" },
  { name: "background", usage: "[提示词]", zh: "把这个会话丢到后台跑，腾出终端", aliases: ["bg"] },
  { name: "branch", usage: "[名字]", zh: "从当前这一步拉一条对话分支" },
  { name: "btw", usage: "[问题]", zh: "顺口问一句，不打断主对话" },
  { name: "cd", usage: "<路径>", zh: "把会话切到另一个工作目录" },
  { name: "color", usage: "", zh: "设置本会话提示条的颜色" },
  { name: "config", usage: "<键>=<值>", zh: "按 key 改一项配置", aliases: ["settings"] },
  { name: "effort", usage: "", zh: "设置模型的思考投入档位" },
  { name: "fast", usage: "", zh: "切换 fast 模式" },
  { name: "feedback", usage: "[报告]", zh: "给 Anthropic 发反馈或报 bug" },
  { name: "focus", usage: "", zh: "切换专注视图：只看你的提示、摘要和回复" },
  { name: "fork", usage: "<指令>", zh: "派生一个继承完整对话的后台 agent" },
  { name: "goal", usage: "[<条件> | clear]", zh: "设一个目标，Claude 想停下时会先自查" },
  { name: "ide", usage: "[open]", zh: "管理 IDE 集成并查看状态" },
  { name: "import", usage: "[codex|gemini|cursor] [--dry-run]", zh: "从其它 AI 编程助手导入配置" },
  { name: "list-agents", usage: "", zh: "列出能发消息的子 agent、队友和其它会话", aliases: ["peers"] },
  { name: "login", usage: "", zh: "登录 Anthropic 账号 / 切换账号" },
  { name: "logout", usage: "", zh: "退出登录" },
  { name: "mobile", usage: "", zh: "显示二维码，下载 Claude 手机 App", aliases: ["ios", "android"] },
  { name: "output-style", usage: "[风格]", zh: "列出输出风格，或切到某个风格" },
  { name: "passes", usage: "", zh: "把 Claude Code 免费一周分享给朋友（可换额度）" },
  { name: "plugin", usage: "", zh: "管理 Claude Code 插件", aliases: ["plugins", "marketplace"] },
  { name: "powerup", usage: "", zh: "用互动小课快速了解 Claude Code 的功能" },
  { name: "radio", usage: "", zh: "听 Claude FM lo-fi 电台" },
  { name: "recap", usage: "", zh: "立刻生成一行会话回顾" },
  { name: "release-notes", usage: "", zh: "查看更新日志" },
  { name: "reload-plugins", usage: "[--force]", zh: "让待生效的插件改动在当前会话里生效" },
  { name: "reload-skills", usage: "", zh: "加载会话期间新增或改动过的 skill" },
  { name: "scroll-speed", usage: "", zh: "调整鼠标滚轮的滚动速度" },
  { name: "security-review", usage: "", zh: "对当前分支上未提交的改动做一次安全审查" },
  { name: "skill-doctor", usage: "", zh: "看哪些已加载的 skill 从没用过、还在占上下文" },
  { name: "statusline", usage: "", zh: "配置状态栏" },
  { name: "stickers", usage: "", zh: "订购 Claude Code 贴纸" },
  { name: "subtask", usage: "<任务>", zh: "带完整上下文派一个子 agent 出去，结果回到这里" },
  { name: "tasks", usage: "", zh: "查看和管理后台在跑的所有东西", aliases: ["bashes"] },
  { name: "terminal-setup", usage: "", zh: "配置终端：Option+Enter 换行、关掉提示音" },
  { name: "theme", usage: "", zh: "换主题" },
  { name: "tui", usage: "[default|fullscreen]", zh: "设置终端 UI 渲染方式（default / fullscreen）" },
  { name: "workflows", usage: "", zh: "浏览正在跑和已完成的 workflow" },
];

/** 常用命令置顶 + 其余按字母序 —— 前缀匹配按这个顺序取前几条 */
export const CLAUDE_SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: "help", usage: "", zh: "显示帮助和可用命令" },
  { name: "clear", usage: "[名字]", zh: "开一个空上下文的新会话（旧会话留在磁盘上，可用 /resume 找回）", aliases: ["reset", "new"] },
  { name: "compact", usage: "<可选的摘要指令>", zh: "压缩上下文：把之前的对话总结掉，腾出空间" },
  { name: "resume", usage: "[会话 id 或搜索词]", zh: "恢复之前的某个对话", aliases: ["continue"] },
  { name: "model", usage: "<模型>", zh: "设置 Claude Code 用的模型" },
  { name: "plan", usage: "[open|<description>]", zh: "打开计划模式，或查看本会话的计划" },
  { name: "permissions", usage: "", zh: "管理工具权限的允许 / 拒绝规则", aliases: ["allowed-tools"] },
  { name: "context", usage: "", zh: "查看当前上下文占用" },
  { name: "usage", usage: "", zh: "查看本会话花费、套餐用量和活动统计", aliases: ["cost", "stats"] },
  { name: "status", usage: "", zh: "查看 Claude Code 状态：版本、模型、账号、API 连通、工具状态" },
  { name: "copy", usage: "", zh: "复制 Claude 上一条回复（/copy N 复制倒数第 N 条）" },
  { name: "export", usage: "[文件名]", zh: "把当前对话导出到文件或剪贴板" },
  { name: "memory", usage: "", zh: "编辑 CLAUDE.md 和记忆设置" },
  { name: "mcp", usage: "[reconnect|enable|disable [<server>|all]]", zh: "管理 MCP 服务器" },
  { name: "hooks", usage: "", zh: "查看各工具事件的 hook 配置" },
  { name: "skills", usage: "", zh: "列出可用的 skill" },
  { name: "diff", usage: "", zh: "查看未提交的改动和每一轮的差异" },
  { name: "init", usage: "", zh: "初始化 CLAUDE.md（给代码库写文档）" },
  { name: "rename", usage: "[名字]", zh: "重命名当前对话", aliases: ["name"] },
  { name: "exit", usage: "", zh: "退出 CLI（后台会话则是脱离、继续跑）", aliases: ["quit"] },
  { name: "update", usage: "", zh: "切到最新版本（对话继续）", aliases: ["restart"] },
  { name: "bug", usage: "", zh: "报 bug 或把你的对话分享给 Anthropic", aliases: ["share"] },
  ...REST,
];

const EMPTY: readonly SlashCommand[] = [];

/** 某个 agent 用哪张表。codex / kimi / 纯终端还没有对照表 —— 空表 = 不显示提示。 */
export function slashCommandsFor(agent: AgentType): readonly SlashCommand[] {
  return agent === "claude" ? CLAUDE_SLASH_COMMANDS : EMPTY;
}
