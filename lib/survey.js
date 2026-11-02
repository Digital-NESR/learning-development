// Training feedback survey, from "NESR Training Survey Template.docx". Ratings are 1 (Poor) to 5 (Excellent).
// Question ids are stored with the answers — add new ids rather than renumbering old ones.
export const SURVEY_SECTIONS = [
  { title: "About the Instructor", questions: [
    { id: "i1", text: "The instructor demonstrated good knowledge of the subject." },
    { id: "i2", text: "The instructor communicated clearly and effectively." },
    { id: "i3", text: "The instructor encouraged participation and answered questions well." },
    { id: "i4", text: "The pace of the training was appropriate." }
  ]},
  { title: "About the Training Materials", questions: [
    { id: "m1", text: "The training materials were clear and easy to follow." },
    { id: "m2", text: "The materials supported the learning objectives." },
    { id: "m3", text: "Handouts or digital materials were helpful and well-organized." }
  ]},
  { title: "About the Training Venue", questions: [
    { id: "v1", text: "The hotel room was convenient and comfortable.", optional: true },
    { id: "v2", text: "The training room/venue was convenient, well equipped, and suitable for learning." },
    { id: "v3", text: "Breaks and schedule were well-managed." },
    { id: "v4", text: "The quality of lunch and coffee breaks was satisfactory." }
  ]},
  { title: "Overall Training Experience", questions: [
    { id: "o1", text: "The training met my expectations." },
    { id: "o2", text: "I can apply what I learned in my role." },
    { id: "o3", text: "I would recommend this training to others." }
  ]}
];

export const SURVEY_QUESTIONS = SURVEY_SECTIONS.flatMap(s => s.questions.map(q => ({ ...q, section: s.title })));

export const SURVEY_COMMENTS = [
  { id: "likedBest", text: "What I liked best about the training" },
  { id: "actionPlan", text: "What I will do after the course to implement the training topics" }
];
