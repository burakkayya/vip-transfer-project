"use client";

import { useCallback, useEffect, useRef } from "react";

/** Yoklama görevine verilen bağlam: iptal sinyali ve sonucun hâlâ geçerli olup olmadığı. */
export type PollContext = { signal: AbortSignal; current: () => boolean };

/**
 * Ortak yoklama (ödeme durumu ve canlı konum):
 * - `enabled` iken her `intervalMs`'de bir `task` çalışır (`immediate` ise hemen de).
 * - Üst üste binmez: istek sürerken yeni yoklama atlanır.
 * - Her istek `timeoutMs`'de iptal edilir (aralıktan kısa tutulur); iptal görevin `catch`'ine hata olarak düşer,
 *   böylece asılı istek de başarısız yoklama sayılır.
 * - Yoklama kapanınca süren istek iptal edilir ve sonucu `current()` ile yok sayılır.
 * `pollNow` aynı korumayla elle yoklar (ör. "Durumu yenile").
 */
export function usePoll(
  task: (ctx: PollContext) => Promise<void>,
  opts: { enabled: boolean; intervalMs: number; timeoutMs: number; immediate?: boolean },
) {
  const { enabled, intervalMs, timeoutMs, immediate = false } = opts;
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });
  const inFlight = useRef<AbortController | null>(null);
  const generation = useRef(0);

  const pollNow = useCallback(async () => {
    if (inFlight.current) return;
    const gen = generation.current;
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      await taskRef.current({ signal: ctrl.signal, current: () => gen === generation.current });
    } finally {
      clearTimeout(timer);
      if (inFlight.current === ctrl) inFlight.current = null;
    }
  }, [timeoutMs]);

  useEffect(() => {
    if (!enabled) return;
    if (immediate) void pollNow();
    const id = setInterval(() => void pollNow(), intervalMs);
    return () => {
      clearInterval(id);
      generation.current += 1;
      inFlight.current?.abort();
      inFlight.current = null;
    };
  }, [enabled, intervalMs, immediate, pollNow]);

  return pollNow;
}
