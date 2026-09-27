-- Adds/updates 7 people as REQUIRED DRIVERS (role='driver', is_required=1,
-- is_active=1, can_do_again=0). Two of these (Daniel Ran, Efi Caro) already
-- exist as testers (see 0002_seed_employees.sql) — this only converts
-- their `employees` role; their separate admin_users accounts (used to
-- log into /admin) are a different table entirely and are untouched.
--
-- national_id has a UNIQUE constraint (0001_init.sql), so this upserts by
-- national_id: idempotent, safe to re-run, never creates a duplicate row.

INSERT INTO employees (first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active, created_at) VALUES
('Efi', 'Caro', '5009', '318316171', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Navot', 'Shukron', '5010', '301241014', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Raeid', 'Azam', '5057', '305146870', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Yehonn', 'Perez', '5066', '208430801', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Geris', 'Abu Shchade', '5015', '318828902', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Nadav', 'Hen', '5087', '209245091', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Daniel', 'Ran', '5099', '318188505', 'driver', 1, 0, 1, CURRENT_TIMESTAMP)
ON CONFLICT(national_id) DO UPDATE SET
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  employee_no = excluded.employee_no,
  role = 'driver',
  is_required = 1,
  is_active = 1,
  can_do_again = 0;
