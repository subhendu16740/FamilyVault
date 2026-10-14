-- ============================================================================
-- 053: Family Plus, sized for a family
--
-- Family Plus (₹100 a month) gave more than the business plans in almost
-- every number: 500 questions a person a month against Business Plus's 100,
-- 500 uploads a day against 300, 100 question tries a day against 30. A
-- small office could keep its paperwork in a family vault for a tenth of
-- the price, and nothing but the terms said otherwise.
--
-- These are numbers no family comes near, so families notice nothing, and
-- an office running its paperwork through a family vault does:
--
--                           before   after
--   questions_fair_use        500     150    a person, a month (049)
--   uploads_per_day           500     100    a person, a day (050; the
--                                            server reads twice that)
--   question_tries_per_day    100      50    a person, a day (050)
--
-- Members (8) and space (10 GB) stay: joint families are big, and a family
-- with years of papers needs the room.
--
-- Each number changes only where it is still the old one, so a number
-- changed in the Table editor since is kept. Gmail import counts toward the
-- day's uploads like any other: from this release it stops at the limit and
-- leaves the rest for the next day (gmail-import, gmail-import.tsx).
--
-- A person's numbers are still the best of their plans (051's
-- person_plans()), so someone in a family on Plus and in a business has the
-- higher of each. Nothing else changes: no function, no grant.
--
-- Safe to run more than once. Needs 049 and 050 (their columns).
-- ============================================================================

UPDATE public.plan_limits SET
  questions_fair_use     = CASE WHEN questions_fair_use = 500     THEN 150 ELSE questions_fair_use END,
  uploads_per_day        = CASE WHEN uploads_per_day = 500        THEN 100 ELSE uploads_per_day END,
  question_tries_per_day = CASE WHEN question_tries_per_day = 100 THEN 50  ELSE question_tries_per_day END
WHERE plan = 'plus';
