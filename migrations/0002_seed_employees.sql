-- Seed data for the ALMOG driver safety exam campaign.
-- national_id values are always quoted strings — several genuinely start
-- with a leading zero (e.g. '052562568', '026165845', '033936840'); do not
-- reformat these as numbers.

-- Required drivers: role='driver', is_required=1
INSERT INTO employees (first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active, created_at) VALUES
('David', 'Forshmedit', '5001', '052562568', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Naser', 'Abu shchade', '5021', '209458660', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Alksander', 'Bek', '5035', '321837635', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Daniel', 'Dechtelberg', '5051', '345367882', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Aleksander', 'Iashenko', '5082', '322023375', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Roberto', 'Salman', '5088', '208111195', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Andre Benk', 'Seti', '5094', '346477292', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Muhamad', 'Garadat', '5139', '201172707', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Anatoly', 'Shabachenko', '5141', '322113390', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Ricardo', 'Simeliovich', '5156', '346260474', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Ricardo', 'Rosenberger', '5157', '346845399', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Mauricio Jose', 'Almeida Goncalves', '5158', '346131956', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Aysar', 'Sawalmy', '5166', '209064013', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Gabiel', 'Bermeguy', '5177', '340952571', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Tamir', 'Karasenti', '5178', '207572629', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Saleem', 'Khalill', '5170', '212981146', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Golan', 'Shor', '5182', '033936840', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Sari', 'Haj', '5183', '318677457', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Bashar', 'Noufal', '5184', '212582548', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Amir', 'Ali', '5187', '205754930', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Poul', 'Zedan', '5190', '318179504', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Elias', 'Abo Hatoum', '5191', '206468787', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Sizar', 'Zohar Lioni', '5138', '205497480', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Roberto Gustavo', 'Zimet', '5095', '346680531', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Serhii', 'Holovko', '5197', '337697270', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Shaif', 'Kadah', '5168', '213565567', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Yevhenii', 'Miasoid', '5201', '341063865', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Alla', 'Suad', '5203', '324296243', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Mauro Antonio', 'De Souza Silva', '5207', '337913428', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Eindal', 'Takala', '5002', '328578125', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Lakew', 'Tesema', '5216', '327304291', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Lior', 'Pasechnik', '5217', '211611983', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Nasri', 'Elias', '5223', '325485134', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Sergei', 'Noskov', '5198', '323511311', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Yaqoub', 'Klinton', '5193', '316136787', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Murad', 'Haj Ahmed', '5224', '211753314', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Dagher', 'Salman', '5226', '314776758', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Roberto', 'Lasman', '5079', '346448574', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Alejandro Dario', 'Kolker', '5175', '347844524', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Tarek', 'Awad', '5077', '206487464', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Jaber', 'Muasa', '5230', '026165845', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Evan', 'Dabag', '5185', '213769268', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Anton', 'Bagri', '5103', '319582110', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Hana', 'Awad', '5018', '315479691', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Lima', 'Klebar', '5140', '337892343', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Anastasia', 'Sorkin', '5124', '337812028', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Avraham', 'Mangasha', '5126', '315044420', 'driver', 1, 0, 1, CURRENT_TIMESTAMP),
('Stanislav', 'Benet', '5052', '322147224', 'driver', 1, 0, 1, CURRENT_TIMESTAMP);

-- Testers: role='tester', is_required=0 — excluded from all completion
-- stats/reports, allowed unlimited repeat attempts.
INSERT INTO employees (first_name, last_name, employee_no, national_id, role, is_required, can_do_again, is_active, created_at) VALUES
('Daniel', 'Ran', '5099', '318188505', 'tester', 0, 0, 1, CURRENT_TIMESTAMP),
('Efi', 'Karo', '5009', '318316171', 'tester', 0, 0, 1, CURRENT_TIMESTAMP);
