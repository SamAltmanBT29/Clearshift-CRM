-- Run against a disposable PostgreSQL test database after crm2_v1.sql:
-- psql "$DATABASE_URL_TEST" -v ON_ERROR_STOP=1 -f apps/crm/modules/crm-2/tests/schema.test.sql
BEGIN;

DO $$
DECLARE
  stage_count integer;
BEGIN
  SELECT count(*) INTO stage_count FROM crm2.crm2_stages;
  IF stage_count <> 6 THEN
    RAISE EXCEPTION 'Expected 6 CRM-2 stages, found %', stage_count;
  END IF;

  IF (SELECT count(*) FROM crm2.crm2_stages WHERE is_won) <> 1
     OR NOT EXISTS (SELECT 1 FROM crm2.crm2_stages WHERE name = 'Won' AND is_won) THEN
    RAISE EXCEPTION 'Won stage seed is incorrect';
  END IF;

  BEGIN
    INSERT INTO crm2.crm2_stages (name, position, is_won)
    VALUES ('Custom', 7, false);
    RAISE EXCEPTION 'Expected stage constraints to reject custom stage';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    UPDATE crm2.crm2_stages SET name = 'Renamed' WHERE name = 'New';
    RAISE EXCEPTION 'Expected fixed-stage trigger to reject update';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    NULL;
  END;
END $$;

DO $$
DECLARE
  deal_id uuid;
  new_stage_id uuid;
BEGIN
  SELECT id INTO new_stage_id FROM crm2.crm2_stages WHERE name = 'New';

  INSERT INTO crm2.crm2_deals (name, contact_id, value, currency, stage_id)
  VALUES ('Synthetic orphan deal', NULL, 1250.50, 'INR', new_stage_id)
  RETURNING id INTO deal_id;

  BEGIN
    INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
    VALUES ('Invalid negative deal', -1, 'INR', new_stage_id);
    RAISE EXCEPTION 'Expected negative deal value to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO crm2.crm2_deals (name, value, currency, stage_id)
    VALUES ('Invalid currency', 10, 'inr', new_stage_id);
    RAISE EXCEPTION 'Expected invalid currency to fail';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  INSERT INTO crm2.crm2_quotes (quote_number, deal_id, quote_date, amount, note)
  VALUES ('TEST-CRM2-001', deal_id, DATE '2026-01-15', 1250.50, 'Synthetic fixture');

  BEGIN
    INSERT INTO crm2.crm2_quotes (quote_number, deal_id, quote_date, amount)
    VALUES ('TEST-CRM2-001', deal_id, DATE '2026-01-16', 10);
    RAISE EXCEPTION 'Expected duplicate quote number to fail';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;

ROLLBACK;
