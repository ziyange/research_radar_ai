/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { useMemo, useState } from "react";
import { X } from "@phosphor-icons/react";

function fieldInputType(field) {
  if (field.type === "secret") return "password";
  if (field.type === "number") return "number";
  return "text";
}

function normalizeEmailProvider(value) {
  return value === "smtp" ? "smtp" : "agent_mail";
}

function optionLabel(option) {
  if (option === "agent_mail") return "Agent Mail";
  if (option === "smtp") return "SMTP";
  return option;
}

export function SettingsModal({ config, loading, onClose, onSave }) {
  const [values, setValues] = useState(() => {
    const initial = Object.fromEntries((config?.fields || []).map((field) => [field.key, field.value ?? ""]));
    initial.EMAIL_PROVIDER = normalizeEmailProvider(initial.EMAIL_PROVIDER);
    return initial;
  });
  const selectedEmailProvider = normalizeEmailProvider(values.EMAIL_PROVIDER);
  const groups = useMemo(() => {
    const map = new Map();
    for (const field of config?.fields || []) {
      const group = field.group || "其他";
      if (group === "邮箱推送 / Agent Mail" && selectedEmailProvider !== "agent_mail") continue;
      if (group === "邮箱推送 / SMTP" && selectedEmailProvider !== "smtp") continue;
      if (!map.has(group)) map.set(group, []);
      map.get(group).push(field);
    }
    return [...map.entries()];
  }, [config, selectedEmailProvider]);

  function update(key, value) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSave({ ...values, EMAIL_PROVIDER: selectedEmailProvider });
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card settings-modal" onClick={(event) => event.stopPropagation()} onSubmit={submit}>
        <div className="modal-header">
          <div>
            <h2>运行设置</h2>
            <p className="modal-hint">修改后会写入后端根目录 .env。选择邮件推送方式后，只显示对应方式的配置项。</p>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </div>
        <div className="modal-body settings-modal-body">
          <div className="settings-env-path">配置文件：{config?.envPath || ".env"}</div>
          {groups.map(([group, fields]) => (
            <section className="settings-section" key={group}>
              <h3>{group}</h3>
              <div className="settings-field-grid">
                {fields.map((field) => (
                  <label className="settings-field" key={field.key}>
                    <span>{field.label}</span>
                    {field.type === "select" ? (
                      <select
                        value={field.key === "EMAIL_PROVIDER" ? selectedEmailProvider : values[field.key] ?? ""}
                        onChange={(event) => update(field.key, event.target.value)}
                      >
                        {(field.options || []).map((option) => (
                          <option value={option} key={option}>
                            {optionLabel(option)}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "boolean" ? (
                      <select value={String(values[field.key] || "false")} onChange={(event) => update(field.key, event.target.value)}>
                        <option value="true">开启</option>
                        <option value="false">关闭</option>
                      </select>
                    ) : (
                      <input
                        type={fieldInputType(field)}
                        value={values[field.key] ?? ""}
                        placeholder={field.secret && field.hasValue ? "已填写，留空则不修改" : ""}
                        onChange={(event) => update(field.key, event.target.value)}
                      />
                    )}
                    <small>{field.description}</small>
                  </label>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn-ghost" onClick={onClose}>
            取消
          </button>
          <button type="submit" className="primary" disabled={loading}>
            {loading ? "保存中" : "保存设置"}
          </button>
        </div>
      </form>
    </div>
  );
}
