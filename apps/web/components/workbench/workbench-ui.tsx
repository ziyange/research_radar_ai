"use client";

import { FormEvent, KeyboardEvent, ReactNode, useState } from "react";
import { CheckCircle2, CircleSlash2, Loader2, Plus, X } from "lucide-react";

import type { ToastState } from "./workbench-types";

export function Toast({ toast }: { toast: NonNullable<ToastState> }) {
  return (
    <div className={`toast ${toast.tone}`} role="status">
      {toast.tone === "success" ? <CheckCircle2 size={16} /> : <CircleSlash2 size={16} />}
      <span>{toast.message}</span>
    </div>
  );
}

export function LoadingState({ text }: { text: string }) {
  return (
    <div className="state-line loading">
      <Loader2 className="spin" size={16} />
      {text}
    </div>
  );
}

export function EmptyState({
  action,
  text,
  title,
}: {
  action?: ReactNode;
  text: string;
  title?: string;
}) {
  return (
    <div className="state-line empty">
      {title ? <b>{title}</b> : null}
      <span>{text}</span>
      {action}
    </div>
  );
}

export function Modal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="modal"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="panel-header">
          <h2 className="panel-title">{title}</h2>
          <button className="icon-button" aria-label="关闭弹窗" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

export function DetailDrawer({
  children,
  onClose,
  title,
  subtitle,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-modal="true"
        className="detail-drawer"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="drawer-top">
          <div>
            {subtitle ? <p className="eyebrow">{subtitle}</p> : null}
            <h2 className="panel-title">{title}</h2>
          </div>
          <button className="icon-button" aria-label="关闭详情" type="button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  );
}

export function TagList({
  empty = "暂无",
  limit,
  values,
}: {
  empty?: string;
  limit?: number;
  values: string[];
}) {
  const shown = limit ? values.slice(0, limit) : values;
  if (shown.length === 0) {
    return <span className="muted-text">{empty}</span>;
  }
  return (
    <div className="chips">
      {shown.map((value, index) => (
        <span className={`chip ${index === 0 ? "strong" : ""}`} key={`${value}-${index}`}>
          {value}
        </span>
      ))}
      {limit && values.length > limit ? <span className="chip">+{values.length - limit}</span> : null}
    </div>
  );
}

export function ChipEditor({
  label,
  onChange,
  placeholder = "输入后回车添加",
  suggestions = [],
  values,
}: {
  label: string;
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  values: string[];
}) {
  const [draft, setDraft] = useState("");

  function addValue(value: string) {
    const next = value.trim();
    if (!next || values.includes(next)) {
      return;
    }
    onChange([...values, next]);
    setDraft("");
  }

  function removeValue(value: string) {
    onChange(values.filter((item) => item !== value));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") {
      return;
    }
    event.preventDefault();
    addValue(draft);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    addValue(draft);
  }

  return (
    <div className="chip-editor">
      <div className="chip-editor-head">
        <span>{label}</span>
        {suggestions.length ? <em>AI 建议可直接接受</em> : null}
      </div>
      <div className="editable-chip-row">
        {values.length === 0 ? <span className="muted-text">暂无标签</span> : null}
        {values.map((value) => (
          <button
            className="chip editable"
            key={value}
            title="点击删除"
            type="button"
            onClick={() => removeValue(value)}
          >
            {value}
            <X size={12} />
          </button>
        ))}
      </div>
      <form className="chip-input-row" onSubmit={handleSubmit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
        />
        <button className="icon-button" aria-label={`添加${label}`} type="submit">
          <Plus size={15} />
        </button>
      </form>
      {suggestions.length ? (
        <div className="suggestion-row">
          {suggestions
            .filter((item) => !values.includes(item))
            .slice(0, 5)
            .map((item) => (
              <button className="suggestion-chip" key={item} type="button" onClick={() => addValue(item)}>
                {item}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}
