"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../../lib/api";
import type { BusyKey, ToastState } from "./workbench-types";

export function asErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}

export function useToast() {
  const [toast, setToast] = useState<ToastState>(null);

  const showToast = useCallback((tone: NonNullable<ToastState>["tone"], message: string) => {
    setToast({ tone, message });
  }, []);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => setToast(null), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  return { toast, showToast, clearToast: () => setToast(null) };
}

export function useBusyState() {
  const [busy, setBusy] = useState<Partial<Record<BusyKey, boolean>>>({ initial: true });

  const setBusyKey = useCallback((key: BusyKey, value: boolean) => {
    setBusy((current) => ({ ...current, [key]: value }));
  }, []);

  const runAction = useCallback(
    async (key: BusyKey, action: () => Promise<void>, onError: (message: string) => void) => {
      setBusyKey(key, true);
      try {
        await action();
      } catch (actionError) {
        onError(asErrorMessage(actionError));
      } finally {
        setBusyKey(key, false);
      }
    },
    [setBusyKey]
  );

  return { busy, setBusyKey, runAction };
}
