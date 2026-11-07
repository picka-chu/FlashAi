-- Atomic task claim + credit.
-- The unique constraint on user_tasks(telegram_id, task_id) makes the insert
-- fail for duplicate claims; because it is in the same transaction as the
-- credit update, a failed claim can never leave the user credited without a
-- completed row (or vice versa).

CREATE OR REPLACE FUNCTION public.claim_task_reward(
  p_telegram_id BIGINT,
  p_task_id UUID,
  p_reward INTEGER
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_credits INTEGER;
BEGIN
  INSERT INTO public.user_tasks (telegram_id, task_id, completed_at)
  VALUES (p_telegram_id, p_task_id, now());

  UPDATE public.users
  SET credits = GREATEST(0, COALESCE(credits, 0) + GREATEST(0, p_reward)),
      last_active = now(),
      updated_at = now()
  WHERE telegram_id = p_telegram_id
  RETURNING credits INTO v_credits;

  IF v_credits IS NULL THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;

  RETURN v_credits;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_task_reward(BIGINT, UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_task_reward(BIGINT, UUID, INTEGER) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_task_reward(BIGINT, UUID, INTEGER) TO service_role;