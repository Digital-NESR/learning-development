-- NESR L&D Portal — starting data (run after 01_create_tables.sql)
-- Training calendar and notification templates from the Claude Design. Safe to run once.

BEGIN;

INSERT INTO "notification_templates" ("id", "name", "trigger", "subject", "body") VALUES
  ('submitted', 'Request Submitted', 'Employee submits a registration', 'Your training request has been received', 'Hi {{first_name}}, we received your request for {{session_code}} — {{training_title}} on {{dates}}. It is now with {{manager_name}} for approval.'),
  ('manager', 'Manager Approval Needed', 'Request enters the manager stage', 'Action needed: training approval for {{employee_name}}', '{{employee_name}} has requested {{training_title}} ({{dates}}, {{location}}). Review and approve or decline in the L&D Portal.'),
  ('enrolled', 'Enrollment Confirmed', 'L&D confirms a seat', 'You are enrolled: {{training_title}}', 'Your seat is confirmed for {{session_code}} on {{dates}} at {{location}}. Joining instructions and pre-work are attached.'),
  ('declined', 'Request Not Approved', 'Manager or L&D declines', 'Update on your training request', 'Your request for {{training_title}} was not approved for this cycle. Talk with {{manager_name}} about alternative sessions.')
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "trainings" ("code", "title", "category", "type", "start_date", "end_date", "location", "seats", "enrolled", "instructor", "description") VALUES
  ('TNT-01', 'Technical For Non Technical (UAE Staff)', 'General Technical Awareness', 'Non Technical', '2026-09-21', '2026-09-24', 'Abu Dhabi, UAE', 20, 20, 'A. Rahman', 'Four-day immersion giving non-technical staff a working vocabulary of NESR service lines, well construction and field operations.'),
  ('LDR-04', 'Leadership Essentials for New Managers', 'Supervisory', 'Non Technical', '2026-09-28', '2026-09-30', 'Dubai, UAE', 25, 18, 'K. Mansour', 'Practical toolkit for first-time people managers: delegation, feedback conversations, and performance planning the NESR way.'),
  ('SFT-02', 'Presentation Skills Masterclass', 'Soft Skills', 'Non Technical', '2026-09-07', '2026-09-08', 'Virtual Classroom', 25, 23, 'L. Brennan', 'Structure, deliver and defend a business presentation to client and executive audiences.'),
  ('FIN-02', 'Financial Acumen for Non-Finance', 'Finance', 'Non Technical', '2026-10-05', '2026-10-07', 'Cairo, Egypt', 20, 11, 'M. Fahmy', 'Read a P&L, understand cost drivers of a service line, and build a defensible budget request.'),
  ('OPS-07', 'Well Intervention Fundamentals', 'Operation Management', 'Technical', '2026-10-12', '2026-10-16', 'Dammam, KSA', 16, 9, 'R. Delgado', 'Intervention techniques, tool strings, and job-planning workflows with hands-on yard exercises.'),
  ('TNT-02', 'Technical For Non Technical (KSA Staff)', 'General Technical Awareness', 'Non Technical', '2026-10-18', '2026-10-22', 'Al Khobar, KSA', 24, 21, 'A. Rahman', 'Five-day KSA cohort of the flagship technical awareness program, including a field visit.'),
  ('HSE-03', 'Defensive Driving (Desert Operations)', 'HSE', 'HSE', '2026-10-26', '2026-10-27', 'Al Khobar, KSA', 20, 14, 'S. Alotaibi', 'Mandatory certification for all staff driving company vehicles in remote and desert terrain.'),
  ('SCT-05', 'Contract Negotiation & Tendering', 'Sales, Contracting & Tendering', 'Non Technical', '2026-11-02', '2026-11-04', 'Houston, USA', 18, 6, 'J. Whitfield', 'Bid strategy, commercial terms and negotiation practice using real NESR tender scenarios.'),
  ('SFT-09', 'Effective Business Writing', 'Soft Skills', 'Non Technical', '2026-11-09', '2026-11-10', 'Virtual Classroom', 30, 12, 'L. Brennan', 'Write clear reports, emails and client updates in plain US English.'),
  ('TNT-03', 'Technical For Non Technical (Egypt & Libya Staff)', 'General Technical Awareness', 'Non Technical', '2026-11-15', '2026-11-18', 'Cairo, Egypt', 24, 20, 'A. Rahman', 'Regional cohort covering service lines, HSE basics and operational terminology.'),
  ('TEC-12', 'Coiled Tubing Level II', 'Technical Operations', 'Technical', '2026-11-23', '2026-11-27', 'Dammam, KSA', 12, 8, 'R. Delgado', 'Advanced coiled tubing operations, fatigue management and job design. Level I certification required.'),
  ('OPS-03', 'Supply Chain & Inventory Control', 'Operation Management', 'Non Technical', '2026-12-01', '2026-12-02', 'Al Khobar, KSA', 20, 7, 'N. Iyer', 'Stock policy, demand planning and warehouse KPIs across NESR bases.'),
  ('MGT-06', 'Project Management Fundamentals', 'Management', 'Non Technical', '2026-12-07', '2026-12-10', 'Dubai, UAE', 20, 4, 'K. Mansour', 'Scope, schedule and risk management for service delivery and internal improvement projects.'),
  ('HSE-08', 'Incident Investigation & Root Cause', 'HSE', 'HSE', '2026-12-14', '2026-12-16', 'Al Khobar, KSA', 16, 10, 'S. Alotaibi', 'Structured investigation method, evidence handling and corrective action design.');

COMMIT;
