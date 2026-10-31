/*
  # Unreliable operator detection

  Adds a SECURITY DEFINER function `get_unreliable_operators` that returns the
  list of operators whose recent orders fail early most of the time.

  An operator is flagged unreliable when:
    - It has at least 3 orders in the last 7 days for the given country + service.
    - At least 50% of those orders ended as `failed` or `canceled` without an
      SMS code, within 10 minutes of purchase.

  The edge function uses the result to hide those operators from the offers
  list and to exclude them when a customer picks "any operator", so 5SIM never
  routes a purchase to a supplier that cuts orders short.

  Security: the function is server-only. EXECUTE is revoked from PUBLIC/anon/
  authenticated and granted only to service_role.
*/

CREATE OR REPLACE FUNCTION public.get_unreliable_operators(
  p_country text,
  p_service text,
  p_since timestamptz DEFAULT now() - interval '7 days'
)
RETURNS TABLE (operator_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT pn.operator_name
  FROM public.purchased_numbers pn
  WHERE pn.country_code = p_country
    AND pn.service_name = p_service
    AND pn.operator_name IS NOT NULL
    AND pn.operator_name <> 'any'
    AND pn.created_at >= p_since
  GROUP BY pn.operator_name
  HAVING count(*) >= 3
     AND 100.0 * count(*) FILTER (
              WHERE pn.status IN ('failed','canceled')
                AND pn.sms_code IS NULL
                AND extract(epoch from (pn.updated_at - pn.created_at)) / 60 < 10
            ) / count(*) >= 50;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_unreliable_operators(text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unreliable_operators(text, text, timestamptz) TO service_role;