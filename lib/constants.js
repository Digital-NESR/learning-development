// Shared lookup lists and defaults (used by the UI, server actions and the seed script).

export const CATEGORIES = ["Finance","General Technical Awareness","HSE","Management","Operation Management","Sales, Contracting & Tendering","Soft Skills","Supervisory","Technical Operations"];
export const TYPES = ["Technical","Non Technical","HSE"];
export const LOCATIONS = ["Al Khobar, KSA","Dammam, KSA","Abu Dhabi, UAE","Dubai, UAE","Cairo, Egypt","Houston, USA","Virtual Classroom"];
export const DEPTS = ["Operations","Engineering","Finance","HSE","Supply Chain","Human Resources","Sales & Commercial","IT"];
export const NATIONALITIES = ["Saudi Arabia","United Arab Emirates","Egypt","India","Pakistan","United Kingdom","United States","Other"];

/** How many managers above the requester must approve. The design uses one level. */
export const APPROVAL_LEVELS = 1;

export const SEED_TRAININGS = [
  {code:"TNT-01", title:"Technical For Non Technical (UAE Staff)", category:"General Technical Awareness", type:"Non Technical", start:"2026-09-21", end:"2026-09-24", location:"Abu Dhabi, UAE", seats:20, enrolled:20, instructor:"A. Rahman", desc:"Four-day immersion giving non-technical staff a working vocabulary of NESR service lines, well construction and field operations."},
  {code:"LDR-04", title:"Leadership Essentials for New Managers", category:"Supervisory", type:"Non Technical", start:"2026-09-28", end:"2026-09-30", location:"Dubai, UAE", seats:25, enrolled:18, instructor:"K. Mansour", desc:"Practical toolkit for first-time people managers: delegation, feedback conversations, and performance planning the NESR way."},
  {code:"SFT-02", title:"Presentation Skills Masterclass", category:"Soft Skills", type:"Non Technical", start:"2026-09-07", end:"2026-09-08", location:"Virtual Classroom", seats:25, enrolled:23, instructor:"L. Brennan", desc:"Structure, deliver and defend a business presentation to client and executive audiences."},
  {code:"FIN-02", title:"Financial Acumen for Non-Finance", category:"Finance", type:"Non Technical", start:"2026-10-05", end:"2026-10-07", location:"Cairo, Egypt", seats:20, enrolled:11, instructor:"M. Fahmy", desc:"Read a P&L, understand cost drivers of a service line, and build a defensible budget request."},
  {code:"OPS-07", title:"Well Intervention Fundamentals", category:"Operation Management", type:"Technical", start:"2026-10-12", end:"2026-10-16", location:"Dammam, KSA", seats:16, enrolled:9, instructor:"R. Delgado", desc:"Intervention techniques, tool strings, and job-planning workflows with hands-on yard exercises."},
  {code:"TNT-02", title:"Technical For Non Technical (KSA Staff)", category:"General Technical Awareness", type:"Non Technical", start:"2026-10-18", end:"2026-10-22", location:"Al Khobar, KSA", seats:24, enrolled:21, instructor:"A. Rahman", desc:"Five-day KSA cohort of the flagship technical awareness program, including a field visit."},
  {code:"HSE-03", title:"Defensive Driving (Desert Operations)", category:"HSE", type:"HSE", start:"2026-10-26", end:"2026-10-27", location:"Al Khobar, KSA", seats:20, enrolled:14, instructor:"S. Alotaibi", desc:"Mandatory certification for all staff driving company vehicles in remote and desert terrain."},
  {code:"SCT-05", title:"Contract Negotiation & Tendering", category:"Sales, Contracting & Tendering", type:"Non Technical", start:"2026-11-02", end:"2026-11-04", location:"Houston, USA", seats:18, enrolled:6, instructor:"J. Whitfield", desc:"Bid strategy, commercial terms and negotiation practice using real NESR tender scenarios."},
  {code:"SFT-09", title:"Effective Business Writing", category:"Soft Skills", type:"Non Technical", start:"2026-11-09", end:"2026-11-10", location:"Virtual Classroom", seats:30, enrolled:12, instructor:"L. Brennan", desc:"Write clear reports, emails and client updates in plain US English."},
  {code:"TNT-03", title:"Technical For Non Technical (Egypt & Libya Staff)", category:"General Technical Awareness", type:"Non Technical", start:"2026-11-15", end:"2026-11-18", location:"Cairo, Egypt", seats:24, enrolled:20, instructor:"A. Rahman", desc:"Regional cohort covering service lines, HSE basics and operational terminology."},
  {code:"TEC-12", title:"Coiled Tubing Level II", category:"Technical Operations", type:"Technical", start:"2026-11-23", end:"2026-11-27", location:"Dammam, KSA", seats:12, enrolled:8, instructor:"R. Delgado", desc:"Advanced coiled tubing operations, fatigue management and job design. Level I certification required."},
  {code:"OPS-03", title:"Supply Chain & Inventory Control", category:"Operation Management", type:"Non Technical", start:"2026-12-01", end:"2026-12-02", location:"Al Khobar, KSA", seats:20, enrolled:7, instructor:"N. Iyer", desc:"Stock policy, demand planning and warehouse KPIs across NESR bases."},
  {code:"MGT-06", title:"Project Management Fundamentals", category:"Management", type:"Non Technical", start:"2026-12-07", end:"2026-12-10", location:"Dubai, UAE", seats:20, enrolled:4, instructor:"K. Mansour", desc:"Scope, schedule and risk management for service delivery and internal improvement projects."},
  {code:"HSE-08", title:"Incident Investigation & Root Cause", category:"HSE", type:"HSE", start:"2026-12-14", end:"2026-12-16", location:"Al Khobar, KSA", seats:16, enrolled:10, instructor:"S. Alotaibi", desc:"Structured investigation method, evidence handling and corrective action design."}
];

export const DEFAULT_TEMPLATES = [
  {id:"submitted", name:"Request Submitted", trigger:"Employee submits a registration", subject:"Your training request has been received",
   body:"Hi {{first_name}}, we received your request for {{session_code}} — {{training_title}} on {{dates}}. It is now with {{manager_name}} for approval."},
  {id:"manager", name:"Manager Approval Needed", trigger:"Request enters the manager stage", subject:"Action needed: training approval for {{employee_name}}",
   body:"{{employee_name}} has requested {{training_title}} ({{dates}}, {{location}}). Review and approve or decline in the L&D Portal."},
  {id:"enrolled", name:"Enrollment Confirmed", trigger:"L&D confirms a seat", subject:"You are enrolled: {{training_title}}",
   body:"Your seat is confirmed for {{session_code}} on {{dates}} at {{location}}. Joining instructions and pre-work are attached."},
  {id:"declined", name:"Request Not Approved", trigger:"Manager or L&D declines", subject:"Update on your training request",
   body:"Your request for {{training_title}} was not approved for this cycle. Talk with {{manager_name}} about alternative sessions."}
];

/** Demo people for DEMO_LOGIN (testing before SSO is live). Mirrors the design's sample org. */
export const DEMO_PEOPLE = [
  {email:"tarek.boutros@demo.nesr.com", name:"Tarek Boutros", nesrId:"10007", title:"VP Operations", department:"Executive", location:"Houston, USA", boss:null},
  {email:"nadia.farouk@demo.nesr.com", name:"Nadia Farouk", nesrId:"10044", title:"Regional Director, MENA", department:"Operations", location:"Dubai, UAE", boss:"tarek.boutros@demo.nesr.com"},
  {email:"yousef.alqahtani@demo.nesr.com", name:"Yousef Al-Qahtani", nesrId:"10182", title:"Operations Manager", department:"Operations", location:"Al Khobar, KSA", boss:"nadia.farouk@demo.nesr.com"},
  {email:"mohammed.alharbi@demo.nesr.com", name:"Mohammed Al-Harbi", nesrId:"10428", title:"Field Engineer II", department:"Operations", location:"Al Khobar, KSA", boss:"yousef.alqahtani@demo.nesr.com"},
  {email:"sara.okonkwo@demo.nesr.com", name:"Sara Okonkwo", nesrId:"11290", title:"Wireline Engineer", department:"Engineering", location:"Dubai, UAE", boss:"yousef.alqahtani@demo.nesr.com"},
  {email:"huda.alsayegh@demo.nesr.com", name:"Huda Al-Sayegh", nesrId:"10310", title:"L&D Administrator", department:"Human Resources", location:"Al Khobar, KSA", boss:"nadia.farouk@demo.nesr.com", admin:true}
];
