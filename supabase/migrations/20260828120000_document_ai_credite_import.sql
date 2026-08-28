-- Document AI — infrastructura de credite pentru importul automat de întrebări.
--
-- Conține:
--   1. Normalizarea coloanei `credite_import_reset_la` (era NULL pe toate organizațiile,
--      ceea ce ar fi făcut resetul lunar să nu se declanșeze niciodată).
--   2. `aplica_reset_credite_import`  — auto-corecție pasivă a ciclului lunar.
--   3. `get_credite_disponibile_x100` — soldul curent, în sutimi de credit.
--   4. `check_org_limits`             — funcția existentă, extinsă (reset pasiv + resursa
--                                       'credite_import'). Restul verificărilor rămân identice.
--   5. `consuma_credite_import`       — consum atomic per chunk, cu prag de descoperire.
--   6. `anuleaza_sesiune_import`      — restituire completă la anulare.

-- ---------------------------------------------------------------------------
-- 1. credite_import_reset_la: backfill + default + NOT NULL
-- ---------------------------------------------------------------------------

ALTER TABLE public.organizatii
  ALTER COLUMN credite_import_reset_la SET DEFAULT (now() + interval '30 days');

UPDATE public.organizatii
   SET credite_import_reset_la = now() + interval '30 days'
 WHERE credite_import_reset_la IS NULL;

ALTER TABLE public.organizatii
  ALTER COLUMN credite_import_reset_la SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Reset pasiv al ciclului lunar de credite
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.aplica_reset_credite_import(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lunare_x100    integer;
  v_consumate_x100 integer;
  v_acumulate_x100 integer;
  v_reset_la       timestamptz;
  v_perioade       integer;
  v_nou_acumulate  integer;
BEGIN
  -- FOR UPDATE: blochează rândul până la finalul tranzacției, astfel încât
  -- verificarea soldului și scrierea consumului să fie atomice pentru apelanți.
  SELECT credite_import_lunare * 100,
         credite_import_consumate_x100,
         credite_import_acumulate_x100,
         credite_import_reset_la
    INTO v_lunare_x100, v_consumate_x100, v_acumulate_x100, v_reset_la
    FROM public.organizatii
   WHERE id = p_org_id
     FOR UPDATE;

  IF NOT FOUND OR v_reset_la IS NULL OR v_reset_la > now() THEN
    RETURN;
  END IF;

  -- Numărul de cicluri de 30 de zile scurse de la ultimul reset programat.
  -- Organizațiile dormante pot rata mai multe cicluri deodată.
  v_perioade := floor(extract(epoch FROM (now() - v_reset_la)) / (30 * 86400))::integer + 1;

  -- Primul ciclu reportează soldul lunar nefolosit. Ciclurile ratate ulterioare
  -- reportează alocația întreagă (consum zero în ele). Plafon: două luni.
  -- Un consum peste alocație (descoperirea de max. 2 credite) se reportează ca
  -- report negativ, deci datoria nu se șterge la schimbarea ciclului.
  v_nou_acumulate := v_acumulate_x100 + (v_lunare_x100 - v_consumate_x100);
  IF v_perioade > 1 THEN
    v_nou_acumulate := v_nou_acumulate + (v_perioade - 1) * v_lunare_x100;
  END IF;
  v_nou_acumulate := LEAST(v_nou_acumulate, v_lunare_x100 * 2);

  UPDATE public.organizatii
     SET credite_import_acumulate_x100 = v_nou_acumulate,
         credite_import_consumate_x100 = 0,
         credite_import_reset_la       = v_reset_la + (v_perioade * interval '30 days')
   WHERE id = p_org_id;
END;
$$;

COMMENT ON FUNCTION public.aplica_reset_credite_import(uuid) IS
  'Auto-corecție pasivă a ciclului lunar de credite Document AI. Idempotentă; apelată de get_credite_disponibile_x100 și check_org_limits.';

-- ---------------------------------------------------------------------------
-- 3. Soldul curent de credite (în sutimi)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_credite_disponibile_x100(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lunare_x100    integer;
  v_consumate_x100 integer;
  v_acumulate_x100 integer;
  v_extra_x100     integer;
BEGIN
  PERFORM public.aplica_reset_credite_import(p_org_id);

  SELECT credite_import_lunare * 100,
         credite_import_consumate_x100,
         credite_import_acumulate_x100,
         credite_import_extra_x100
    INTO v_lunare_x100, v_consumate_x100, v_acumulate_x100, v_extra_x100
    FROM public.organizatii
   WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  RETURN (v_lunare_x100 + v_acumulate_x100 - v_consumate_x100) + v_extra_x100;
END;
$$;

COMMENT ON FUNCTION public.get_credite_disponibile_x100(uuid) IS
  'Soldul de credite Document AI al organizației, în sutimi de credit. Aplică întâi resetul lunar restant.';

-- ---------------------------------------------------------------------------
-- 4. check_org_limits — funcția existentă, extinsă
--    Modificări față de versiunea anterioară:
--      a) resetul pasiv de credite rulează înaintea oricărei verificări;
--      b) rândul organizației se citește DUPĂ reset, ca să nu fie stale;
--      c) resursă nouă: 'credite_import'.
--    Verificările existente (useri / admini / examene / tokeni) rămân neschimbate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.check_org_limits(p_org_id uuid, p_resource text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org public.organizatii%ROWTYPE;
  v_current integer := 0;
  v_max integer := 0;
BEGIN
  -- Auto-corecție pasivă a resetului lunar de credite, înaintea oricărei verificări.
  PERFORM public.aplica_reset_credite_import(p_org_id);

  SELECT * INTO v_org
  FROM public.organizatii
  WHERE id = p_org_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'current', 0, 'max', 0, 'error', 'org_not_found');
  END IF;

  -- Organizații managed manual sau grandfathered → mereu allowed
  IF v_org.is_managed_manually THEN
    RETURN jsonb_build_object('allowed', true, 'current', 0, 'max', -1, 'managed_manually', true);
  END IF;

  CASE p_resource
    WHEN 'useri' THEN
      SELECT COUNT(*) INTO v_current
      FROM public.profiles
      WHERE org_id = p_org_id
        AND role = 'user';
      v_max := v_org.max_useri;

    WHEN 'admini' THEN
      SELECT COUNT(*) INTO v_current
      FROM public.profiles
      WHERE org_id = p_org_id
        AND role = 'org_admin';
      v_max := v_org.max_admini;

    WHEN 'examene' THEN
      SELECT COUNT(*) INTO v_current
      FROM public.examene
      WHERE org_id = p_org_id;
      v_max := v_org.max_examene;

    WHEN 'tokeni' THEN
      v_current := v_org.tokeni_consumati_luna;
      v_max := v_org.tokeni_lunari;

    WHEN 'credite_import' THEN
      -- Măsurat în sutimi de credit. `max` include reportul și creditele extra.
      v_current := v_org.credite_import_consumate_x100;
      v_max := v_org.credite_import_lunare * 100
             + v_org.credite_import_acumulate_x100
             + v_org.credite_import_extra_x100;

    ELSE
      RETURN jsonb_build_object('allowed', false, 'current', 0, 'max', 0, 'error', 'invalid_resource');
  END CASE;

  RETURN jsonb_build_object(
    'allowed',  v_current < v_max,
    'current',  v_current,
    'max',      v_max,
    'remaining', v_max - v_current
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Consum atomic de credite per chunk
--    Verificarea pragului și scrierea consumului trebuie să fie o singură
--    operațiune; altfel două chunk-uri procesate în paralel pot depăși pragul.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.consuma_credite_import(
  p_sesiune_id            uuid,
  p_org_id                uuid,
  p_cost_x100             integer,
  p_intrebari             integer,
  p_intrebari_verificare  integer,
  p_prag_negativ_x100     integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_disponibil_x100 integer;
  v_cost            integer := GREATEST(coalesce(p_cost_x100, 0), 0);
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM public.document_ai_sesiuni_import
     WHERE id = p_sesiune_id
       AND org_id = p_org_id
       AND status = 'in_progres'
  ) THEN
    RETURN jsonb_build_object('aplicat', false, 'motiv', 'sesiune_invalida', 'credite_ramase_x100', 0);
  END IF;

  -- Aplică resetul restant și blochează rândul organizației până la COMMIT.
  v_disponibil_x100 := public.get_credite_disponibile_x100(p_org_id);

  IF v_cost > 0 AND (v_disponibil_x100 - v_cost) < coalesce(p_prag_negativ_x100, 0) THEN
    RETURN jsonb_build_object(
      'aplicat', false,
      'motiv', 'credite_insuficiente',
      'credite_ramase_x100', v_disponibil_x100
    );
  END IF;

  IF v_cost > 0 THEN
    UPDATE public.organizatii
       SET credite_import_consumate_x100 = credite_import_consumate_x100 + v_cost
     WHERE id = p_org_id;
  END IF;

  UPDATE public.document_ai_sesiuni_import
     SET credite_consumate_x100 = credite_consumate_x100 + v_cost,
         numar_intrebari_extrase = numar_intrebari_extrase
                                 + GREATEST(coalesce(p_intrebari, 0), 0),
         numar_intrebari_marcate_verificare = numar_intrebari_marcate_verificare
                                 + GREATEST(coalesce(p_intrebari_verificare, 0), 0)
   WHERE id = p_sesiune_id;

  RETURN jsonb_build_object(
    'aplicat', true,
    'motiv', null,
    'credite_ramase_x100', v_disponibil_x100 - v_cost
  );
END;
$$;

COMMENT ON FUNCTION public.consuma_credite_import(uuid, uuid, integer, integer, integer, integer) IS
  'Scade atomic costul unui chunk Document AI. Refuză consumul dacă soldul ar coborî sub pragul de descoperire.';

-- ---------------------------------------------------------------------------
-- 6. Anulare cu restituire completă
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.anuleaza_sesiune_import(
  p_sesiune_id uuid,
  p_org_id     uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_restituit_x100 integer;
BEGIN
  SELECT credite_consumate_x100
    INTO v_restituit_x100
    FROM public.document_ai_sesiuni_import
   WHERE id = p_sesiune_id
     AND org_id = p_org_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('gasit', false, 'restituit_x100', 0);
  END IF;

  -- Sesiunile deja anulate au credite_consumate_x100 = 0, deci reapelarea e no-op.
  IF v_restituit_x100 > 0 THEN
    UPDATE public.organizatii
       SET credite_import_consumate_x100 = GREATEST(credite_import_consumate_x100 - v_restituit_x100, 0)
     WHERE id = p_org_id;
  END IF;

  UPDATE public.document_ai_sesiuni_import
     SET status = 'anulat',
         finalizat_la = now(),
         credite_consumate_x100 = 0
   WHERE id = p_sesiune_id;

  RETURN jsonb_build_object('gasit', true, 'restituit_x100', v_restituit_x100);
END;
$$;

COMMENT ON FUNCTION public.anuleaza_sesiune_import(uuid, uuid) IS
  'Anulează o sesiune Document AI și restituie integral creditele consumate. Idempotentă.';

-- ---------------------------------------------------------------------------
-- 7. Privilegii
-- ---------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.aplica_reset_credite_import(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consuma_credite_import(uuid, uuid, integer, integer, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.anuleaza_sesiune_import(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_credite_disponibile_x100(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consuma_credite_import(uuid, uuid, integer, integer, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.anuleaza_sesiune_import(uuid, uuid) TO service_role;
