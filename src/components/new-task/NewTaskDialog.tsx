import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, Moon, Plus, Terminal, X } from "lucide-react";
import { useI18n } from "../../i18n";
import s from "../../styles";
import type { AgentType } from "../../types";
import { defaultTaskName } from "../../types";
import claudeLogo from "../../assets/claude.svg";
import chatgptLogo from "../../assets/chatgpt.svg";

interface GitBranchInfo {
  name: string;
  current: boolean;
  remote: string | null;
}

/** 表单里的下拉沿用应用设置那套 select 样式，避免又长出一套控件。 */
export function SelectField({
  value,
  label,
  options,
  onChange,
}: {
  value: string;
  label: string;
  options: Array<{ value: string; label: string; icon?: ReactNode }>;
  onChange: (value: string) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Select.Root value={value} onValueChange={onChange}>
      <Select.Trigger aria-label={label} style={s.settingsSelectTriggerCompact}>
        <Select.Value>
          <span style={s.newTaskDialogSelectValue}>
            {current?.icon}
            {current?.label ?? value}
          </span>
        </Select.Value>
        <Select.Icon>
          <ChevronDown size={13} strokeWidth={2.2} color="var(--text-hint)" />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        {/* z-index 要高于 forkDialogOverlay/Box(2100/2101)，否则弹层被压在弹窗底下点不到 */}
        <Select.Content
          position="popper"
          sideOffset={4}
          style={{ ...s.settingsSelectContent, zIndex: 2200 }}
        >
          <Select.Viewport style={s.settingsSelectViewport}>
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className="radix-select-item"
                  style={selected ? s.settingsSelectOptionSelected : s.settingsSelectOption}
                >
                  <Select.ItemText>
                    <span style={s.newTaskDialogSelectValue}>
                      {option.icon}
                      {option.label}
                    </span>
                  </Select.ItemText>
                  <Select.ItemIndicator style={s.settingsSelectIndicator}>
                    <Check size={13} style={s.settingsSelectCheck} />
                  </Select.ItemIndicator>
                </Select.Item>
              );
            })}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}

/**
 * 新建任务弹窗：只收集「开一个什么样的会话」这件事——名字（可选）、用哪个 agent、
 * 要不要独立副本。提示词不在这里写，创建后直接进终端跟 agent 对话。
 */
export function NewTaskDialog({
  projectPath,
  repoPath,
  onCancel,
  onCreate,
}: {
  projectPath: string;
  repoPath: string;
  onCancel: () => void;
  onCreate: (input: {
    name: string;
    agent: AgentType;
    launchMode: "local" | "worktree";
    baseBranch: string;
  }) => void;
}) {
  const { t } = useI18n();
  // 任务名的默认值就是 task-<id>（与创建任务时的占位名同一格式）。先生成一份做灰色
  // 占位提示——用户不填，创建出来的名字就是它。
  // 名字留空时的默认值按 agent 区分：claude-xxx / codex-xxx / terminal-xxx。
  // 先生成一份 id 做灰色占位提示——用户不填，创建出来的名字就是它。
  const [nameId] = useState(() => `${Date.now()}`);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState<AgentType>("claude");
  const [isolated, setIsolated] = useState(false);
  const [branches, setBranches] = useState<GitBranchInfo[]>([]);
  const [baseBranch, setBaseBranch] = useState("");

  // 打开「独立副本」时才去拉分支：默认选当前分支，省掉一次选择。
  useEffect(() => {
    if (!isolated) return;
    let cancelled = false;
    invoke<GitBranchInfo[]>("git_list_branches", { projectPath, repoPath })
      .then((list) => {
        if (cancelled) return;
        setBranches(list);
        setBaseBranch((prev) => prev || list.find((b) => b.current)?.name || list[0]?.name || "");
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isolated, projectPath, repoPath]);

  const defaultName = defaultTaskName(agent, nameId);
  const canSubmit = !isolated || !!baseBranch;

  function submit() {
    if (!canSubmit) return;
    onCreate({
      name: name.trim() || defaultName,
      agent,
      launchMode: isolated ? "worktree" : "local",
      baseBranch: isolated ? baseBranch : "",
    });
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay style={s.forkDialogOverlay} />
        <Dialog.Content style={s.forkDialogBox} aria-describedby={undefined}>
          <div style={s.forkDialogHeader}>
            <div style={s.forkDialogHeading}>
              <span style={s.forkDialogIcon}>
                <Plus size={16} strokeWidth={2.2} />
              </span>
              <Dialog.Title style={s.forkDialogTitle}>{t("newTask.dialogTitle")}</Dialog.Title>
            </div>
            <Dialog.Close asChild>
              <button type="button" style={s.modalCloseBtn} aria-label={t("common.close")}>
                <X size={15} />
              </button>
            </Dialog.Close>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div style={s.newTaskDialogField}>
              <label style={s.forkDialogLabel} htmlFor="new-task-name">
                {t("newTask.dialogName")}
              </label>
              <input
                id="new-task-name"
                style={s.forkDialogInput}
                value={name}
                maxLength={120}
                placeholder={defaultName}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </div>

            <div style={s.newTaskDialogField}>
              <label style={s.forkDialogLabel}>{t("settings.agent")}</label>
              <SelectField
                value={agent}
                label={t("settings.agent")}
                options={[
                  {
                    value: "claude",
                    label: "Claude Code",
                    icon: <img src={claudeLogo} style={s.toolbarMenuItemIcon} />,
                  },
                  {
                    value: "codex",
                    label: "Codex",
                    icon: <img src={chatgptLogo} style={s.toolbarMenuItemIcon} />,
                  },
                  {
                    value: "kimi",
                    label: "Kimi",
                    icon: <Moon size={14} strokeWidth={2} color="var(--text-muted)" />,
                  },
                  {
                    value: "shell",
                    label: t("terminal.title"),
                    icon: <Terminal size={14} strokeWidth={2} color="var(--text-muted)" />,
                  },
                ]}
                onChange={(value) => setAgent(value as AgentType)}
              />
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isolated}
              style={{ ...s.settingToggle, ...s.newTaskDialogField }}
              onClick={() => setIsolated((prev) => !prev)}
            >
              <span style={s.newTaskDialogToggleText}>
                <span style={s.settingToggleLabel}>{t("newTask.dialogIsolated")}</span>
                <span style={s.newTaskDialogHint}>{t("newTask.dialogIsolatedHint")}</span>
              </span>
              <span style={isolated ? s.settingToggleTrackOn : s.settingToggleTrack}>
                <span style={isolated ? s.settingToggleKnobOn : s.settingToggleKnob} />
              </span>
            </button>

            {isolated && (
              <div style={s.newTaskDialogField}>
                <label style={s.forkDialogLabel}>{t("newTask.baseBranch")}</label>
                <SelectField
                  value={baseBranch}
                  label={t("newTask.baseBranch")}
                  options={branches.map((branch) => ({
                    value: branch.name,
                    label: branch.current ? `${branch.name}${t("branch.current")}` : branch.name,
                  }))}
                  onChange={setBaseBranch}
                />
              </div>
            )}

            <div style={s.forkDialogActions}>
              <Dialog.Close asChild>
                <button type="button" style={s.forkDialogCancelBtn}>
                  {t("common.cancel")}
                </button>
              </Dialog.Close>
              <button
                type="submit"
                style={canSubmit ? s.forkDialogPrimaryBtn : s.forkDialogPrimaryBtnDisabled}
                disabled={!canSubmit}
              >
                {t("newTask.dialogCreate")}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
