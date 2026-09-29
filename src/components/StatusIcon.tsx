import {
  CheckCircle2,
  CircleCheck,
  XCircle,
  MinusCircle,
  Circle,
  CircleDashed,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import type { TaskStatus } from "../types";

export function StatusIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case "pending":
      // 虚线圆：进程正在起来，转瞬即逝的状态
      return <CircleDashed size={14} style={{ color: "var(--text-hint)" }} />;
    case "idle":
      // 绿色空心圆：会话就绪、没在干活（等你说话）。绿=健康，空心=没在干活，和
      // 「正在处理」的绿勾靠形状区分。
      return <Circle size={14} style={{ color: "var(--success)" }} />;
    case "running":
      // 绿勾：进行中=健康，且不再转圈（转圈在恢复出来的空闲会话上会一直转，语义也不对）。
      return <CheckCircle2 size={14} style={{ color: "var(--success)" }} />;
    case "input_required":
      return <AlertCircle size={14} style={{ color: "var(--warning)" }} />;
    case "awaiting_review":
      return <CircleCheck size={14} style={{ color: "var(--accent)" }} />;
    case "interrupted":
      return <AlertTriangle size={14} style={{ color: "var(--warning)" }} />;
    case "done":
      // 灰勾：已完成是"落定"状态，绿色留给进行中。
      return <CheckCircle2 size={14} style={{ color: "var(--text-hint)" }} />;
    case "failed":
      return <XCircle size={14} style={{ color: "var(--danger)" }} />;
    case "cancelled":
      return <MinusCircle size={14} style={{ color: "var(--text-hint)" }} />;
    default:
      return <Circle size={14} style={{ color: "var(--text-hint)" }} />;
  }
}
