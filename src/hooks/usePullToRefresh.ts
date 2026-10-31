import { useEffect, useRef, useState } from "react";

const TRIGGER_DISTANCE = 72;
const MAX_DISTANCE = 110;
const RESISTANCE = 0.5;

export function usePullToRefresh(onRefresh: () => Promise<unknown>) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const onRefreshRef = useRef(onRefresh);
  const refreshingRef = useRef(false);

  useEffect(() => {
    onRefreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let startY: number | null = null;
    let distance = 0;

    const setDistance = (value: number) => {
      distance = value;
      setPull(value);
    };

    const handleTouchStart = (e: TouchEvent) => {
      startY = window.scrollY <= 0 && !refreshingRef.current ? e.touches[0].clientY : null;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (startY === null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0) {
        setDistance(0);
        return;
      }
      setDistance(Math.min(dy * RESISTANCE, MAX_DISTANCE));
    };

    const handleTouchEnd = async () => {
      const triggered = startY !== null && distance >= TRIGGER_DISTANCE;
      startY = null;
      if (!triggered) {
        setDistance(0);
        return;
      }
      refreshingRef.current = true;
      setRefreshing(true);
      setDistance(TRIGGER_DISTANCE);
      try {
        await onRefreshRef.current();
      } catch (err) {
        console.error("[pull-to-refresh] refresh failed", err);
      } finally {
        refreshingRef.current = false;
        setRefreshing(false);
        setDistance(0);
      }
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd);
    window.addEventListener("touchcancel", handleTouchEnd);
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  return { pull, refreshing };
}
