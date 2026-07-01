/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { Bell, CheckCircle, SpinnerGap, WarningCircle, X } from "@phosphor-icons/react";

function toneIcon(tone) {
  if (tone === "running") return <SpinnerGap size={16} className="activity-spin" />;
  if (tone === "error") return <WarningCircle size={16} weight="fill" />;
  return <CheckCircle size={16} weight="fill" />;
}

function toneLabel(tone) {
  if (tone === "running") return "执行中";
  if (tone === "error") return "错误";
  if (tone === "warning") return "提示";
  if (tone === "success") return "完成";
  return "消息";
}

export function ActivityCenter({ activities, open, onToggle, onRemove }) {
  const activeCount = (activities || []).filter((item) => item.tone === "running").length;
  const errorCount = (activities || []).filter((item) => item.tone === "error" || item.tone === "warning").length;
  return (
    <div className="activity-center">
      {open ? (
        <div className="activity-popover">
          <div className="activity-header">
            <div>
              <strong>任务与消息</strong>
              <span>{activeCount ? `${activeCount} 个任务执行中` : "暂无执行中的任务"}</span>
            </div>
            <button type="button" onClick={onToggle} aria-label="关闭任务中心">
              <X size={16} />
            </button>
          </div>
          <div className="activity-list">
            {activities?.length ? (
              activities.map((item) => (
                <div className={`activity-item ${item.tone}`} key={item.id}>
                  <div className="activity-item-icon">{toneIcon(item.tone)}</div>
                  <div>
                    <strong>{toneLabel(item.tone)}</strong>
                    <p>{item.message}</p>
                  </div>
                  {item.tone !== "running" ? (
                    <button type="button" onClick={() => onRemove(item.id)} aria-label="删除消息">
                      <X size={14} />
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="activity-empty">当前没有执行中的任务或未处理消息。</div>
            )}
          </div>
        </div>
      ) : null}
      <button type="button" className={`activity-toggle ${errorCount ? "has-error" : ""}`} onClick={onToggle}>
        <Bell size={19} weight="fill" />
        {activeCount || errorCount ? <span>{activeCount + errorCount}</span> : null}
      </button>
    </div>
  );
}
