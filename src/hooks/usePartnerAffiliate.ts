import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export type PartnerAffiliate = {
  id: string;
  code: string;
  name: string;
  email: string;
  phone: string | null;
  city: string | null;
  payout_method: string | null;
  upi_id: string | null;
  commission_rate: number;
  created_at: string;
};

export const usePartnerAffiliate = () => {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["partner-profile", user?.id],
    queryFn: async (): Promise<PartnerAffiliate | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .from("affiliates" as any)
        .select("id, code, name, email, phone, city, payout_method, upi_id, commission_rate, created_at")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: String(data.id),
        code: String(data.code ?? ""),
        name: String(data.name ?? ""),
        email: String(data.email ?? ""),
        phone: data.phone == null ? null : String(data.phone),
        city: data.city == null ? null : String(data.city),
        payout_method: data.payout_method == null ? null : String(data.payout_method),
        upi_id: data.upi_id == null ? null : String(data.upi_id),
        commission_rate: Number(data.commission_rate ?? 0),
        created_at: String(data.created_at ?? ""),
      };
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });
};
