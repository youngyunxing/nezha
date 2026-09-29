import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, ChevronDown, AlertTriangle } from "lucide-react";
import * as Select from "@radix-ui/react-select";
import { useI18n } from "../../i18n";
import {
  clampTerminalScrollback,
  normalizeTaskDisplayWindow,
  TASK_DISPLAY_WINDOW_VALUES,
  TERMINAL_SCROLLBACK_MIN,
  TERMINAL_SCROLLBACK_MAX,
  TERMINAL_SCROLLBACK_STEP,
  type TaskDisplayWindow,
  type TerminalScrollback,
} from "../../types";
import s from "../../styles";
import { APP_SETTINGS_CHANGED_EVENT, type AppSettings } from "./types";

export function GeneralPanel({
  taskDisplayWindow,
  onTaskDisplayWindowChange,
  attentionBadge,
  onAttentionBadgeChange,
  terminalScrollback,
  onTerminalScrollbackChange,
}: {
  taskDisplayWindow: TaskDisplayWindow;
  onTaskDisplayWindowChange: (window: TaskDisplayWindow) => void;
  attentionBadge: boolean;
  onAttentionBadgeChange: (enabled: boolean) => void;
  terminalScrollback: TerminalScrollback;
  onTerminalScrollbackChange: (value: TerminalScrollback) => void;
}) {
  const { t } = useI18n();

  // 框选自动复制开关:面板内自包含加载/保存,不经由
  // App.tsx 透传 props),保存后广播 CHANGED 事件,终端侧的单例监听随之刷新。
  // null = 尚未读到真实值,渲染为关闭态(与后端默认 false 一致,不会闪)。
  const [copyOnSelect, setCopyOnSelect] = useState<boolean | null>(null);
  const [copyOnSelectBusy, setCopyOnSelectBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    invoke<AppSettings>("load_app_settings")
      .then((loaded) => {
        if (!cancelled) setCopyOnSelect(loaded.terminal_copy_on_select);
      })
      .catch(() => {
        if (!cancelled) setCopyOnSelect(false);
      })
      .finally(() => {
        if (!cancelled) setCopyOnSelectBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleCopyOnSelectToggle = async () => {
    if (copyOnSelectBusy || copyOnSelect === null) return;
    const enabled = !copyOnSelect;
    setCopyOnSelect(enabled);
    setCopyOnSelectBusy(true);
    try {
      const next = await invoke<AppSettings>("save_terminal_copy_on_select", { enabled });
      setCopyOnSelect(next.terminal_copy_on_select);
      window.dispatchEvent(new Event(APP_SETTINGS_CHANGED_EVENT));
    } catch {
      setCopyOnSelect(!enabled);
    } finally {
      setCopyOnSelectBusy(false);
    }
  };

  const copyOnSelectOn = copyOnSelect === true;



  const taskDisplayWindowOptions = TASK_DISPLAY_WINDOW_VALUES.map((value) => ({
    value,
    label:
      value === "all"
        ? t("appSettings.taskDisplayAll")
        : t("appSettings.taskDisplayRecentDays", { days: value }),
  }));
  const selectedTaskDisplayWindowLabel =
    taskDisplayWindowOptions.find((option) => option.value === taskDisplayWindow)?.label ??
    t("appSettings.taskDisplayRecentDays", { days: 3 });

  const stepScrollback = (direction: 1 | -1) => {
    onTerminalScrollbackChange(
      clampTerminalScrollback(terminalScrollback + direction * TERMINAL_SCROLLBACK_STEP),
    );
  };

  return (
    <div style={s.settingsBodyColumn}>
      <div style={s.settingFieldSpaced}>
        <label style={s.settingFieldLabel}>{t("appSettings.taskDisplayWindow")}</label>
        <Select.Root
          value={String(taskDisplayWindow)}
          onValueChange={(value) => onTaskDisplayWindowChange(normalizeTaskDisplayWindow(value))}
        >
          <Select.Trigger
            aria-label={t("appSettings.taskDisplayWindow")}
            style={s.settingsSelectTriggerCompact}
          >
            <Select.Value>{selectedTaskDisplayWindowLabel}</Select.Value>
            <Select.Icon>
              <ChevronDown size={13} strokeWidth={2.2} color="var(--text-hint)" />
            </Select.Icon>
          </Select.Trigger>
          <Select.Portal>
            <Select.Content position="popper" sideOffset={4} style={s.settingsSelectContent}>
              <Select.Viewport style={s.settingsSelectViewport}>
                {taskDisplayWindowOptions.map((option) => {
                  const optionValue = String(option.value);
                  const selected = option.value === taskDisplayWindow;

                  return (
                    <Select.Item
                      key={optionValue}
                      value={optionValue}
                      className="radix-select-item"
                      style={selected ? s.settingsSelectOptionSelected : s.settingsSelectOption}
                    >
                      <Select.ItemText>{option.label}</Select.ItemText>
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
        <span style={s.settingFieldHint}>{t("appSettings.taskDisplayWindowHint")}</span>
      </div>

      <div style={s.settingFieldSpaced}>
        <label style={s.settingFieldLabel}>{t("appSettings.attentionBadge")}</label>
        <button
          type="button"
          role="switch"
          aria-checked={attentionBadge}
          aria-label={t("appSettings.attentionBadge")}
          onClick={() => onAttentionBadgeChange(!attentionBadge)}
          style={s.settingToggle}
        >
          <span style={s.settingToggleLabel}>{t("appSettings.attentionBadgeToggle")}</span>
          <span style={attentionBadge ? s.settingToggleTrackOn : s.settingToggleTrack}>
            <span style={attentionBadge ? s.settingToggleKnobOn : s.settingToggleKnob} />
          </span>
        </button>
        <span style={s.settingFieldHint}>{t("appSettings.attentionBadgeHint")}</span>
      </div>

      <div style={s.settingFieldSpaced}>
        <label style={s.settingFieldLabel}>{t("appSettings.terminalScrollback")}</label>
        <div style={s.fontSizeControls}>
          <input
            type="number"
            inputMode="numeric"
            min={TERMINAL_SCROLLBACK_MIN}
            max={TERMINAL_SCROLLBACK_MAX}
            step={TERMINAL_SCROLLBACK_STEP}
            value={terminalScrollback}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (Number.isFinite(next)) {
                onTerminalScrollbackChange(clampTerminalScrollback(next));
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp") {
                e.preventDefault();
                stepScrollback(1);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                stepScrollback(-1);
                return;
              }
              if (e.key !== "Tab") {
                e.preventDefault();
              }
            }}
            onPaste={(e) => e.preventDefault()}
            aria-label={t("appSettings.terminalScrollback")}
            style={s.settingsNumberInput}
          />
          <span style={s.fontSizeUnit}>{t("appSettings.terminalScrollbackUnit")}</span>
        </div>
        <span style={s.settingFieldHint}>{t("appSettings.terminalScrollbackHint")}</span>
        {terminalScrollback > 3000 && (
          <div style={s.settingsFieldWarning} role="alert">
            <AlertTriangle size={13} strokeWidth={2} style={s.settingsFieldWarningIcon} />
            <span>{t("appSettings.terminalScrollbackWarning")}</span>
          </div>
        )}
      </div>

      <div style={s.settingFieldSpaced}>
        <label style={s.settingFieldLabel}>{t("appSettings.copyOnSelect")}</label>
        <button
          type="button"
          role="switch"
          aria-checked={copyOnSelectOn}
          aria-label={t("appSettings.copyOnSelect")}
          disabled={copyOnSelectBusy}
          data-checked={copyOnSelectOn}
          data-disabled={copyOnSelectBusy}
          onClick={() => void handleCopyOnSelectToggle()}
          className="app-settings-toggle"
        >
          <span className="app-settings-toggle-label">{t("appSettings.copyOnSelectToggle")}</span>
          <span className="app-settings-toggle-track">
            <span className="app-settings-toggle-knob" />
          </span>
        </button>
        <span style={s.settingFieldHint}>{t("appSettings.copyOnSelectHint")}</span>
      </div>

    </div>
  );
}
