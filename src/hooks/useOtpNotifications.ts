import { useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { notifyOtpReceived } from "../lib/native";
import type { PurchasedNumber } from "../types";

type OtpUpdate = Pick<PurchasedNumber, "id" | "fivesim_id" | "status" | "sms_code">;

export function useOtpNotifications() {
  const { profile } = useAuth();

  useEffect(() => {
    if (!profile?.id) return;

    const channel = supabase
      .channel(`otp-notifications-${profile.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "purchased_numbers",
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          const number = payload.new as OtpUpdate;
          if (number.status === "received" && number.sms_code?.trim()) {
            void notifyOtpReceived(number.fivesim_id ?? number.id);
          }
        },
      )
      .subscribe((status, error) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("[otp-notifications] realtime subscription failed", error);
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [profile?.id]);
}
