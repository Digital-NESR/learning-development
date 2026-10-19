"use client";
// Portal state + view-model. Ported from the logic block of design/LD Portal.dc.html;
// data comes from the database (lib/data.ts) and changes go through server actions (app/actions.ts).
import React from "react";
import PortalView from "./PortalView";
import * as actions from "@/app/actions";
import { APPROVAL_LEVELS, CATEGORIES, DEPTS, LOCATIONS, NATIONALITIES, TYPES } from "@/lib/constants.js";
import { AUDIENCES, ENROLLED_STATES, PLACEHOLDERS, REGISTERED_STATES, audienceIds } from "@/lib/audience.js";
import { dateRange } from "@/lib/training-format.js";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const STATE_STYLE = {
  pending:   {label:"Awaiting Approval", bg:"#FDF2D9", fg:"#8A6100"},
  lnd:       {label:"With L&D Team",     bg:"#E3EEFA", fg:"#1F4E79"},
  enrolled:  {label:"Enrolled",          bg:"#C5E0D2", fg:"#1F5E3A"},
  waitlist:  {label:"Waitlisted",        bg:"#EEF1EF", fg:"#4A4B4D"},
  rejected:  {label:"Not Approved",      bg:"#F7DEDE", fg:"#8A2B2B"},
  completed: {label:"Completed",         bg:"#C5E0D2", fg:"#1F5E3A"}
};

const RESOURCES = [
  {title:"Training Calendar User Guide", desc:"How to search sessions, submit a request and track approvals end to end.", meta:"PDF · 1.4 MB"},
  {title:"L&D Organization Chart", desc:"Who to contact in the Learning & Development team by region and discipline.", meta:"PDF · 620 KB"},
  {title:"Training & Development Policy", desc:"Eligibility, cost coverage, travel rules and post-training commitments.", meta:"PDF · 880 KB"},
  {title:"Competency Framework", desc:"Role-based learning paths for technical and non-technical career tracks.", meta:"Web page"}
];

function initialsOf(n){ return String(n||"?").split(" ").map(w => w[0]).slice(0,2).join(""); }
const pad = n => String(n).padStart(2, "0");
const todayIso = () => { const d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); };
const isoMs = s => Date.UTC(Number(s.slice(0,4)), Number(s.slice(5,7)) - 1, Number(s.slice(8,10)));
const withOption = (opts, v) => v && !opts.includes(v) ? [v].concat(opts) : opts;

export default class Portal extends React.Component {
  constructor(props) {
    super(props);
    const d = props.initial;
    const now = new Date();
    this.state = Object.assign({
      teamOpen: {},
      editorError: false,
      screen: "dashboard",
      calView: "table",
      month: now.getMonth(), calYear: now.getFullYear(),
      q: "", fType: "All", fCat: "All", fSeats: "All", fLoc: "All",
      detailId: null,
      form: null,
      justification: "",
      editor: null,
      sessionId: null,
      busy: false,
      rosterTab: "registered",
      mail: {trainingId: "", audience: "registered", templateId: "", subject: "", body: ""},
      plate: {trainingId: "", who: "participants", customName: "", from: "", to: ""},
      toast: null
    }, this.fromSnapshot(d));
  }

  fromSnapshot(d) {
    return {
      meId: d.meId, isAdminUser: d.isAdmin, canManage: d.canManage, people: d.people,
      trainings: d.trainings, requests: d.requests, attended: d.attended,
      templatesOff: d.templatesOff, templateRows: d.templates, mailInfo: d.mail
    };
  }

  componentWillUnmount() { clearTimeout(this._tt); }

  flash(title, body) {
    clearTimeout(this._tt);
    this.setState({toast: {title, body}});
    this._tt = setTimeout(() => this.setState({toast: null}), 4200);
  }

  /** Calls a server action, swaps in the fresh data and shows a toast. */
  async act(promiseFn, title, body, extra) {
    if (this.state.busy) return;
    this.setState({busy: true});
    try {
      const res = await promiseFn();
      if (res.ok) {
        this.setState(Object.assign(this.fromSnapshot(res.data), extra || {}, {busy: false}));
        // title may be a function of the fresh data returning [title, body]
        const [tt, bb] = typeof title === "function" ? title(res.data) : [title, body];
        if (tt) this.flash(tt, bb);
      } else {
        this.setState({busy: false});
        this.flash("Couldn't save that change", res.error);
      }
    } catch (e) {
      this.setState({busy: false});
      if (/server action|deployment/i.test(String(e && e.message)))
        this.flash("The portal was updated", "Refresh the page (F5) and try again. Nothing was saved.");
      else
        this.flash("Couldn't reach the server", "Check your connection and try again.");
    }
  }

  /** Re-reads data from the server in the background (e.g. latest seat counts). */
  async refreshQuiet() {
    try {
      const res = await actions.refresh();
      if (res.ok) this.setState(this.fromSnapshot(res.data));
    } catch { /* keep what we have */ }
  }

  P(id) { return this.state.people[id]; }
  t(id) { return this.state.trainings.find(x => x.id === id); }
  me() { return this.P(this.state.meId); }

  chainFor(key) {
    const out = []; let cur = (this.P(key) || {}).boss;
    while (cur && this.P(cur) && out.length < APPROVAL_LEVELS && cur !== key) { out.push(cur); cur = this.P(cur).boss; }
    return out;
  }
  reportsOf(key) { return Object.keys(this.state.people).filter(k => this.P(k).boss === key); }

  dayNum(s) { return Number(s.slice(8, 10)); }
  monNum(s) { return Number(s.slice(5, 7)) - 1; }
  yearOf(s) { return Number(s.slice(0, 4)); }
  range(t) {
    const a = this.dayNum(t.start), b = this.dayNum(t.end);
    const ma = this.monNum(t.start), mb = this.monNum(t.end);
    return ma === mb ? a + "–" + b + " " + SHORT[mb] + " " + this.yearOf(t.end) : a + " " + SHORT[ma] + " – " + b + " " + SHORT[mb];
  }
  days(t) { return Math.round((isoMs(t.end) - isoMs(t.start)) / 86400000) + 1; }

  ageDays(r) { return Math.max(0, Math.round((Date.now() - new Date(r.submittedAt).getTime()) / 86400000)); }

  seatState(t) {
    const left = t.seats - t.enrolled;
    if (left <= 0) return {label:"Class Full", bg:"#EEF1EF", fg:"#4A4B4D", bar:"#58595B"};
    if (left <= 4) return {label:"Filling Up", bg:"#DCEBE3", fg:"#1F5E3A", bar:"#6AAF8E"};
    return {label:"Seats Open", bg:"#C5E0D2", fg:"#1F5E3A", bar:"#2A7E4F"};
  }

  filtered() {
    const st = this.state, q = st.q.trim().toLowerCase();
    return st.trainings.filter(t => {
      if (q && (t.title + " " + t.code + " " + t.category).toLowerCase().indexOf(q) < 0) return false;
      if (st.fType !== "All" && t.type !== st.fType) return false;
      if (st.fCat !== "All" && t.category !== st.fCat) return false;
      if (st.fLoc !== "All" && t.location !== st.fLoc) return false;
      if (st.fSeats === "Seats available" && t.enrolled >= t.seats) return false;
      if (st.fSeats === "Class full" && t.enrolled < t.seats) return false;
      return true;
    }).sort((a, b) => a.start < b.start ? -1 : 1);
  }

  photoFor(t) {
    if (!t) return "/assets/photo-crew-walking.png";
    if (t.type === "HSE") return "/assets/photo-toolbox-talk.png";
    if (t.type === "Technical") return "/assets/photo-wellhead.png";
    return "/assets/photo-crew-walking.png";
  }

  defaultForm() {
    const p = this.me();
    const boss = p.boss ? this.P(p.boss) : null;
    return {nesrId: p.nesrId === "—" ? "" : p.nesrId, name: p.name, loc: p.loc || "", dept: p.dept || "",
      nat: "", mgr: boss ? boss.email : ""};
  }

  openDetail(id) {
    this.setState({detailId: id, justification: "", formError: false, form: this.state.form || this.defaultForm()});
    this.refreshQuiet(); // so seats left are current
  }

  row(t, i) {
    const s = this.seatState(t);
    const left = Math.max(0, t.seats - t.enrolled);
    return {
      id: t.id, code: t.code, title: t.title, category: t.category, type: t.type,
      dates: this.range(t), location: t.location, st: s, photo: this.photoFor(t),
      seatsLabel: left > 0 ? left + " of " + t.seats + " left" : "Full (" + t.seats + ")",
      fillPct: Math.min(100, Math.round(t.enrolled / Math.max(1, t.seats) * 100)),
      zebra: i % 2 ? "#FAFBFA" : "#FFFFFF",
      cta: left > 0 ? "Register →" : "Join waitlist →",
      onClick: () => this.openDetail(t.id)
    };
  }

  setForm(k) { return e => this.setState({form: Object.assign({}, this.state.form, {[k]: e.target.value})}); }
  setEditor(k) { return e => this.setState({editor: Object.assign({}, this.state.editor, {[k]: e.target.value})}); }

  submitRequest() {
    const t = this.t(this.state.detailId);
    if (!t) return;
    const chain = this.chainFor(this.state.meId);
    const form = this.state.form || this.defaultForm();
    const missing = [!form.loc && "work location", !form.dept && "department", !form.nat && "nationality"].filter(Boolean);
    if (missing.length) {
      this.setState({formError: true});
      this.flash("Some details are missing", "Please choose your " + missing.join(", ") + ".");
      return;
    }
    const next = chain.length ? this.P(chain[0]) : null;
    const viaForm = !next && form.mgr;
    this.act(() => actions.submitRequest({trainingId: t.id, justification: this.state.justification, form}),
      data => {
        const mine = data.requests.find(r => r.who === data.meId && r.tid === t.id);
        if (mine && mine.state === "waitlist")
          return ["Added to the waitlist", t.code + " is full. You keep your place in the queue and will be notified if a seat opens."];
        return ["Request submitted, seat reserved",
          next ? "Sent to " + next.name + (next.title ? " (" + next.title + ")" : "") + " for approval. L&D is notified at each step." :
          viaForm ? "Sent to " + form.mgr + " for approval. L&D is notified at each step." :
                    "You have no approver above you — routed straight to the L&D team for enrollment."];
      }, null,
      {detailId: null, justification: ""});
  }

  saveTraining() {
    const ed = this.state.editor;
    if (ed.kind === "template") {
      this.act(() => actions.saveTemplate(ed), "Template saved", ed.name + " was updated.", {editor: null});
      return;
    }
    const blank = v => !String(v ?? "").trim();
    const missing = [["code","session code"],["instructor","instructor"],["title","training title"],["category","category"],["type","type"],
      ["start","start date"],["end","end date"],["location","location"],["seats","seat capacity"],["desc","description"]]
      .filter(([k]) => blank(ed[k])).map(([, label]) => label);
    if (!blank(ed.seats) && !(Math.floor(Number(ed.seats)) >= 1)) missing.push("seat capacity (a number, at least 1)");
    if (missing.length) {
      this.setState({editorError: true});
      this.flash("Some fields are empty", "Please fill in: " + missing.join(", ") + ".");
      return;
    }
    if (ed.end < ed.start) {
      this.setState({editorError: true});
      this.flash("Check the dates", "The end date must be on or after the start date.");
      return;
    }
    this.act(() => actions.saveTraining(ed), ed.id ? "Training updated" : "Training published", ed.code + " — " + ed.title, {editor: null, editorError: false});
  }

  setMail(patch) { this.setState({mail: Object.assign({}, this.state.mail, patch)}); }
  setPlate(patch) { this.setState({plate: Object.assign({}, this.state.plate, patch)}); }

  /** Downloads the nameplate PDF from /api/nameplate. */
  async downloadPlates(body, label) {
    if (this.state.busy) return;
    this.setState({busy: true});
    try {
      const res = await fetch("/api/nameplate", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.flash("Couldn't create the PDF", err.error || "Try again in a moment.");
        return;
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : "nameplates.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      this.flash("Nameplates ready", label);
    } catch {
      this.flash("Couldn't reach the server", "Check your connection and try again.");
    } finally {
      this.setState({busy: false});
    }
  }

  renderVals() {
    const st = this.state;
    const scr = st.screen;
    const mk = (k, v, d) => ({k, v, d});
    const YEAR = new Date().getFullYear();
    const TODAY = todayIso();

    const meP = this.me();
    const isAdmin = st.isAdminUser;
    const canManage = st.canManage;
    const myReports = this.reportsOf(meP.key);

    const pendingAll = st.requests.filter(r => r.state === "pending").length;
    const pendingLnd = st.requests.filter(r => r.state === "lnd").length;
    const onMe = st.requests.filter(r => r.state === "pending" && (r.chain || [])[r.step] === meP.key).length;
    const mineOpen = st.requests.filter(r => r.who === meP.key && (r.state === "pending" || r.state === "lnd")).length;
    const badges = {approvals: onMe, queue: pendingLnd, requests: mineOpen};

    const navItem = ([k, label]) => {
      const on = scr === k || (k === "trainings" && scr === "session");
      return {
        isItem: true, isHeader: false,
        label, weight: on ? "bold" : "normal",
        bg: on ? "#F2F7F4" : "transparent", fg: on ? "#1F5E3A" : "#3E403E",
        edge: on ? "#2A7E4F" : "transparent",
        badge: badges[k] || 0,
        badgeBg: on ? "#2A7E4F" : "#E7EBE9", badgeFg: on ? "#FFFFFF" : "#58595B",
        onClick: () => this.setState({screen: k, detailId: null})
      };
    };
    const section = (label, items, first) =>
      [{isHeader: true, isItem: false, label, pad: first ? "0 16px 8px" : "18px 16px 8px"}].concat(items.map(navItem));
    const nav = section("Employee", [["dashboard","My Dashboard"],["calendar","Training Calendar"],["requests","My Requests"],["resources","Resources"]], true)
      .concat(canManage ? section("Manager", [["approvals","Team Approvals"],["team","Team Development"]]) : [])
      .concat(isAdmin ? section("L&D Team", [["adminDash","Dashboard"],["trainings","Manage Trainings"],["queue","Approval Queue"],["attendance","Attendance"],["templates","Notifications"]]) : []);

    const s = {
      empDash: scr === "dashboard",
      cal: scr === "calendar",
      myReq: scr === "requests",
      res: scr === "resources",
      mgrApp: canManage && scr === "approvals",
      mgrTeam: canManage && scr === "team",
      aDash: isAdmin && scr === "adminDash",
      aTrain: isAdmin && scr === "trainings",
      aSession: isAdmin && scr === "session",
      aApp: isAdmin && scr === "queue",
      aAtt: isAdmin && scr === "attendance",
      aNotify: isAdmin && scr === "templates"
    };

    const list = this.filtered();
    const rows = list.map((t, i) => this.row(t, i));

    const viewTabs = [["table","Table"],["month","Month"],["cards","Catalog"]].map(([k, label]) => ({
      label, bg: st.calView === k ? "#FFFFFF" : "transparent", fg: st.calView === k ? "#2A7E4F" : "#58595B",
      onClick: () => this.setState({calView: k})
    }));

    const filters = [
      {label:"Type", value: st.fType, options:["All"].concat(TYPES), onChange: e => this.setState({fType: e.target.value})},
      {label:"Category", value: st.fCat, options:["All"].concat(CATEGORIES), onChange: e => this.setState({fCat: e.target.value})},
      {label:"Location", value: st.fLoc, options:["All"].concat(LOCATIONS), onChange: e => this.setState({fLoc: e.target.value})},
      {label:"Availability", value: st.fSeats, options:["All","Seats available","Class full"], onChange: e => this.setState({fSeats: e.target.value})}
    ];

    const first = new Date(st.calYear, st.month, 1).getDay();
    const dim = new Date(st.calYear, st.month + 1, 0).getDate();
    const monthCells = [];
    for (let i = 0; i < first; i++) monthCells.push({day:"", items:[], bg:"#FAFBFA", numFg:"#C9CDCB"});
    for (let d = 1; d <= dim; d++) {
      const items = st.trainings.filter(t => this.yearOf(t.start) === st.calYear && this.monNum(t.start) === st.month && this.dayNum(t.start) === d).map(t => {
        const ss = this.seatState(t);
        return {label: t.code + " · " + t.title, bg: ss.bar, onClick: () => this.openDetail(t.id)};
      });
      monthCells.push({day: String(d), items, bg:"#FFFFFF", numFg:"#1F1F1D"});
    }
    while (monthCells.length % 7 !== 0) monthCells.push({day:"", items:[], bg:"#FAFBFA", numFg:"#C9CDCB"});

    const decorate = r => {
      const t = this.t(r.tid) || {code:"—", title:"Removed session", location:"", start:"2026-01-01", end:"2026-01-01"};
      const person = this.P(r.who) || {name:"Unknown", title:"", dept:"", loc:"", nesrId:"—"};
      const form = r.form || {};
      const name = form.name || person.name;
      const chainPeople = (r.chain || []).map(k => this.P(k)).filter(Boolean);
      const cur = r.state === "pending" ? chainPeople[r.step] : null;
      const base = STATE_STYLE[r.state] || STATE_STYLE.pending;
      const stepDefs = [{label:"Submitted", note: r.submitted}]
        .concat(chainPeople.map(p => ({label: p.first, note: p.title})))
        .concat([{label:"L&D Review", note:"Enrollment"}, {label:"Confirmed", note: r.state === "completed" ? "Completed" : "Seat held"}]);
      const failIdx = r.state === "rejected" ? 1 + r.step : -1;
      const prog = r.state === "rejected" ? 1 + r.step
        : r.state === "pending" ? 1 + r.step
        : r.state === "waitlist" ? 1
        : r.state === "lnd" ? 1 + chainPeople.length
        : stepDefs.length;
      const steps = stepDefs.map((d, i) => {
        const failed = i === failIdx;
        const active = i < prog;
        return {
          label: d.label,
          note: failed ? "Declined" : i === 0 ? r.submitted : active ? "Done" : (i === prog && r.state === "pending" ? "Awaiting" : d.note),
          bar: failed ? "#8A2B2B" : active ? "#2A7E4F" : "#E1E5E3",
          fg: failed ? "#8A2B2B" : active ? "#1F5E3A" : "#A8ACAA"
        };
      });
      const nextIdx = r.step + 1;
      return {
        id: r.id, code: t.code, title: t.title, employee: name, initials: initialsOf(name),
        empMeta: "NESR ID " + (form.nesrId || person.nesrId) + " · " + person.title + " · " + (form.loc || person.loc),
        manager: cur ? cur.name + (cur.title ? " (" + cur.title + ")" : "") : chainPeople.length ? chainPeople[chainPeople.length - 1].name : "—",
        chainNote: chainPeople.map(p => p.first).join(" → ") + (chainPeople.length ? " → " : "") + "L&D Team",
        justification: r.justification,
        meta: this.range(t) + " · " + t.location + " · submitted " + r.submitted,
        st: {label: r.state === "pending" ? (cur ? "Awaiting " + cur.first : "Awaiting Approval") : base.label, bg: base.bg, fg: base.fg},
        state: r.state, stage: r.state, steps,
        actionable: r.state === "pending" && (r.chain || [])[r.step] === meP.key,
        onApprove: () => {
          const done = nextIdx >= chainPeople.length;
          this.act(() => actions.approveRequest(r.id), "Approved",
            done ? name + " approved for " + t.code + ". Now with the L&D team for enrollment."
                 : name + " approved — routed to " + chainPeople[nextIdx].name + " for the next approval.");
        },
        onReject: () => this.act(() => actions.rejectRequest(r.id), "Request declined", name + " and the L&D team have been notified."),
        onEnroll: () => this.act(() => actions.enrollRequest(r.id), "Participant enrolled", name + " confirmed for " + t.code + "."),
        onWaitlist: () => this.act(() => actions.waitlistRequest(r.id), "Moved to waitlist", name + " will be offered the next available seat."),
        onDeclineLnd: () => this.act(() => actions.rejectRequest(r.id), "Request declined", name + " has been notified by the L&D team.")
      };
    };

    const myRequests = st.requests.filter(r => r.who === meP.key).map(decorate);
    const teamRequests = st.requests.filter(r => (r.chain || []).indexOf(meP.key) >= 0).map(decorate)
      .sort((a, b) => (b.actionable ? 1 : 0) - (a.actionable ? 1 : 0));
    const queueRows = st.requests.filter(r => r.state === "lnd" || r.state === "waitlist" || r.state === "pending")
      .map((r, i) => { const d = decorate(r); return Object.assign(d, {zebra: i % 2 ? "#FAFBFA" : "#FFFFFF", onReject: d.onDeclineLnd}); });

    const upcoming = st.trainings.slice().sort((a, b) => a.start < b.start ? -1 : 1);
    const requestedByMe = new Set(st.requests.filter(r => r.who === meP.key).map(r => r.tid));
    const recommended = upcoming.filter(t => t.enrolled < t.seats && t.start >= TODAY && !requestedByMe.has(t.id)).slice(0, 4).map(t => {
      const ss = this.seatState(t);
      return {
        title: t.title, sub: t.category + " · " + t.location, day: String(this.dayNum(t.start)),
        mon: SHORT[this.monNum(t.start)], tint: ss.bg, tintFg: ss.fg,
        seatsLabel: (t.seats - t.enrolled) + " seats",
        onClick: () => this.openDetail(t.id)
      };
    });

    const myForm = st.form || this.defaultForm();
    const detailT = st.detailId ? this.t(st.detailId) : null;
    let detail = null, formFields = [];
    if (detailT) {
      const ss = this.seatState(detailT);
      const left = Math.max(0, detailT.seats - detailT.enrolled);
      const already = st.requests.some(r => r.who === meP.key && r.tid === detailT.id);
      const canApply = !already;
      const myChain = this.chainFor(meP.key).map(k => this.P(k));
      const chainNote = myChain.length
        ? myChain.map(p => p.first + (p.title ? " (" + p.title + ")" : "")).join(" → ") + " → L&D Team"
        : myForm.mgr ? myForm.mgr + " → L&D Team" : "L&D Team";
      detail = {
        code: detailT.code, type: detailT.type, title: detailT.title, desc: detailT.desc, photo: this.photoFor(detailT),
        canApply,
        width: canApply ? "900px" : "600px",
        railBg: canApply ? "#FAFBFA" : "#FFFFFF",
        railBorder: canApply ? "1px solid #EAEEEC" : "0",
        ctaLabel: st.busy ? "Submitting…" : left > 0 ? "Submit Request" : "Join Waitlist",
        chainNote,
        footNote: already ? "You already have a request on file for this session." :
          left > 0 ? left + " of " + detailT.seats + " seats remaining." : "This class is full — waitlist requests are still accepted.",
        facts: [
          mk("Dates", this.range(detailT), "M7 3v3M17 3v3M4 9.5h16M5.5 6h13a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6z"),
          mk("Duration", this.days(detailT) + " days", "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2"),
          mk("Location", detailT.location, "M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"),
          mk("Category", detailT.category, "M4 6.5h5l2 2h9v9.5a1 1 0 01-1 1H5a1 1 0 01-1-1z"),
          mk("Instructor", detailT.instructor || "TBC", "M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20c0-3.3 3.4-5.5 7.5-5.5s7.5 2.2 7.5 5.5"),
          mk("Availability", ss.label, "M8.5 11a3 3 0 100-6 3 3 0 000 6zM2.5 19.5c0-2.8 2.7-4.5 6-4.5s6 1.7 6 4.5M16.5 11a3 3 0 100-6M16 15c3 0 5.5 1.8 5.5 4.5"),
          mk("Approval steps", String(Math.max(myChain.length, myForm.mgr ? 1 : 0) + 1), "M20 6.5L9.5 17 4.5 12")
        ]
      };
      const field = f => Object.assign({border:"#D9DDDB", fg:"#1F1F1D", bg:"#fff", readOnly:false, hint:"", choosePrompt:""}, f);
      const lockedMgr = myChain.length ? myChain[0] : null;
      const natMissing = st.formError && !myForm.nat;
      formFields = [
        field({label:"NESR ID", isText:true, value: myForm.nesrId, placeholder:"e.g. 10428", onChange: this.setForm("nesrId")}),
        field({label:"Full name", isText:true, value: myForm.name, placeholder:"Full name", onChange: this.setForm("name")}),
        field({label:"Work location", isSelect:true, value: myForm.loc, options: withOption(LOCATIONS, myForm.loc), onChange: this.setForm("loc"),
          choosePrompt:"Select from dropdown", fg: myForm.loc ? "#1F1F1D" : "#8A8F8C",
          border: st.formError && !myForm.loc ? "#8A2B2B" : "#D9DDDB", hint: st.formError && !myForm.loc ? "Required" : ""}),
        field({label:"Department", isSelect:true, value: myForm.dept, options: withOption(DEPTS, myForm.dept), onChange: this.setForm("dept"),
          choosePrompt:"Select from dropdown", fg: myForm.dept ? "#1F1F1D" : "#8A8F8C",
          border: st.formError && !myForm.dept ? "#8A2B2B" : "#D9DDDB", hint: st.formError && !myForm.dept ? "Required" : ""}),
        field({label:"Nationality (visa)", isSelect:true, value: myForm.nat, options: NATIONALITIES, onChange: this.setForm("nat"),
          choosePrompt:"Select from dropdown", fg: myForm.nat ? "#1F1F1D" : "#8A8F8C",
          border: natMissing ? "#8A2B2B" : "#D9DDDB", hint: natMissing ? "Required" : ""}),
        lockedMgr
          ? field({label:"Approver", isText:true, value: lockedMgr.email, readOnly:true, bg:"#F2F4F3", fg:"#58595B", onChange: () => {},
              hint:"Your line manager, from your Microsoft profile. If it's wrong, ask HR to update it."})
          : field({label:"Approver email", isText:true, value: myForm.mgr, placeholder:"name@nesr.com", onChange: this.setForm("mgr"),
              hint:"No manager is listed on your Microsoft profile. Enter who should approve."})
      ];
    }

    const ed = st.editor;
    const ef = f => Object.assign({inputType: "text", hint: "", isTextarea: false, rows: "7", border: "#D1D3D4", fg: "#1F1F1D", choosePrompt: ""}, f);
    const miss = v => st.editorError && !String(v ?? "").trim();
    // Required training field: label with *, red border when left empty after trying to save
    const rf = (f, v) => ef(Object.assign({}, f, {label: f.label + " *", border: miss(v) ? "#8A2B2B" : "#D1D3D4"},
      f.isSelect ? {choosePrompt: "Select from dropdown", fg: v ? "#1F1F1D" : "#8A8F8C"} : {}));
    const editorFields = !ed ? [] : ed.kind === "template" ? [
      {label:"Template name", isText:true, span:"1 / -1", value: ed.name, placeholder:"e.g. Joining Instructions", onChange: this.setEditor("name")},
      {label:"When it's used", isText:true, span:"1 / -1", value: ed.trigger, placeholder:"e.g. L&D confirms a seat", onChange: this.setEditor("trigger")},
      {label:"Subject", isText:true, span:"1 / -1", value: ed.subject, placeholder:"Email subject", onChange: this.setEditor("subject")},
      {label:"Message", isTextarea:true, span:"1 / -1", value: ed.body, placeholder:"Email text", onChange: this.setEditor("body"),
        hint: "Placeholders filled per person: " + PLACEHOLDERS.join(" ")}
    ].map(ef) : [
      rf({label:"Session code", isText:true, span:"auto", value: ed.code, placeholder:"TNT-04", onChange: this.setEditor("code")}, ed.code),
      rf({label:"Instructor", isText:true, span:"auto", value: ed.instructor, placeholder:"Lead instructor", onChange: this.setEditor("instructor")}, ed.instructor),
      rf({label:"Training title", isText:true, span:"1 / -1", value: ed.title, placeholder:"Session title", onChange: this.setEditor("title")}, ed.title),
      rf({label:"Category", isSelect:true, span:"auto", value: ed.category, options: CATEGORIES, onChange: this.setEditor("category")}, ed.category),
      rf({label:"Type", isSelect:true, span:"auto", value: ed.type, options: TYPES, onChange: this.setEditor("type")}, ed.type),
      rf({label:"Start date", isText:true, inputType:"date", span:"auto", value: ed.start, onChange: this.setEditor("start")}, ed.start),
      rf({label:"End date", isText:true, inputType:"date", span:"auto", value: ed.end, onChange: this.setEditor("end")}, ed.end),
      rf({label:"Location", isSelect:true, span:"auto", value: ed.location, options: LOCATIONS, onChange: this.setEditor("location")}, ed.location),
      rf({label:"Seat capacity", isText:true, inputType:"number", span:"auto", value: String(ed.seats ?? ""), placeholder:"e.g. 20", onChange: this.setEditor("seats")}, ed.seats),
      rf({label:"Description", isTextarea:true, rows:"3", span:"1 / -1", value: ed.desc, placeholder:"What participants will learn", onChange: this.setEditor("desc")}, ed.desc)
    ];

    const adminRows = list.map((t, i) => {
      const r = this.row(t, i);
      r.onClick = () => this.setState({screen:"session", sessionId: t.id, rosterTab: "registered"});
      r.onView = () => this.setState({screen:"session", sessionId: t.id, rosterTab: "registered"});
      r.onEdit = () => this.setState({editorError: false, editor: Object.assign({}, t, {heading:"Edit Training", cta:"Save Changes"})});
      r.onDelete = () => {
        if (!window.confirm("Withdraw " + t.code + " — " + t.title + " from the calendar?")) return;
        this.act(() => actions.deleteTraining(t.id), "Training removed", t.code + " was withdrawn from the calendar.");
      };
      return r;
    });

    const openReqs = st.requests.filter(r => r.state === "pending" || r.state === "lnd");
    const ages = openReqs.map(r => this.ageDays(r));
    const avgWait = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    const oldestWait = ages.length ? Math.max.apply(null, ages) : 0;
    const slaColor = d => d >= 7 ? "#8A2B2B" : d >= 4 ? "#B07A00" : "#2A7E4F";

    const groups = {};
    openReqs.forEach(r => {
      const k = r.state === "lnd" ? "lnd" : ((r.chain || [])[r.step] || "lnd");
      const who = k === "lnd" ? {name:"L&D Team", title:"Enrollment desk"} : (this.P(k) || {name:"Unknown", title:""});
      if (!groups[k]) groups[k] = {key:k, name: who.name, title: who.title, ages: []};
      groups[k].ages.push(this.ageDays(r));
    });
    const ageingRows = Object.keys(groups).map(k => {
      const g = groups[k];
      const oldest = Math.max.apply(null, g.ages);
      const avg = Math.round(g.ages.reduce((a, b) => a + b, 0) / g.ages.length);
      return {name: g.name, title: g.title, initials: initialsOf(g.name), count: String(g.ages.length),
        oldest: oldest + "d", avg: "avg " + avg + "d", oldestN: oldest,
        pct: String(Math.min(100, Math.round(oldest / 14 * 100))), color: slaColor(oldest),
        flag: oldest >= 7 ? "Overdue" : oldest >= 4 ? "Ageing" : "On track",
        flagBg: oldest >= 7 ? "#F7DEDE" : oldest >= 4 ? "#FDF2D9" : "#C5E0D2",
        flagFg: oldest >= 7 ? "#8A2B2B" : oldest >= 4 ? "#7A5400" : "#1F5E3A"};
    }).sort((a, b) => b.oldestN - a.oldestN);

    const stageAvg = keys => {
      const rs = st.requests.filter(r => keys.indexOf(r.state) >= 0);
      if (!rs.length) return {n:"0", avg:"—", pct:"0"};
      const a = Math.round(rs.reduce((x, r) => x + this.ageDays(r), 0) / rs.length);
      return {n: String(rs.length), avg: a + "d avg in system", pct: String(Math.min(100, Math.round(a / 14 * 100)))};
    };
    const timelineRows = [
      Object.assign({label:"Awaiting manager", color:"#B07A00"}, stageAvg(["pending"])),
      Object.assign({label:"With L&D team", color:"#1F4E79"}, stageAvg(["lnd"])),
      Object.assign({label:"Enrolled", color:"#2A7E4F"}, stageAvg(["enrolled"])),
      Object.assign({label:"Waitlisted", color:"#58595B"}, stageAvg(["waitlist"])),
      Object.assign({label:"Declined", color:"#8A2B2B"}, stageAvg(["rejected"]))
    ];

    const totalSeats = st.trainings.reduce((a, t) => a + t.seats, 0);
    const totalEnrolled = st.trainings.reduce((a, t) => a + t.enrolled, 0);
    const adminKpis = [
      {label:"Active Sessions", value: String(st.trainings.length), note: YEAR + " calendar"},
      {label:"Seat Utilization", value: Math.round(totalEnrolled / Math.max(1, totalSeats) * 100) + "%", note: totalEnrolled + " of " + totalSeats + " seats"},
      {label:"Pending Approvals", value: String(pendingAll + pendingLnd), note: pendingAll + " with managers, " + pendingLnd + " with L&D"},
      {label:"Enrolled", value: String(st.requests.filter(r => r.state === "enrolled").length), note:"Confirmed participants"},
      {label:"Avg Wait", value: avgWait + "d", note:"Time in approval chain"},
      {label:"Oldest Pending", value: oldestWait + "d", note: ageingRows.length ? "with " + ageingRows[0].name : "nothing pending"}
    ];

    const fillRows = upcoming.filter(t => t.end >= TODAY).slice(0, 6).map(t => {
      const pct = Math.round(t.enrolled / Math.max(1, t.seats) * 100);
      return {title: t.code + " · " + t.title, seatsLabel: t.enrolled + "/" + t.seats, pct,
        color: pct >= 100 ? "#58595B" : pct >= 80 ? "#6AAF8E" : "#2A7E4F"};
    });

    const catTotals = {};
    st.trainings.forEach(t => { catTotals[t.category] = (catTotals[t.category] || 0) + t.enrolled; });
    const catMax = Math.max.apply(null, [1].concat(Object.keys(catTotals).map(k => catTotals[k])));
    const catRows = Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]).map((k, i) => ({
      label: k, n: catTotals[k], pct: Math.round(catTotals[k] / catMax * 100),
      color: ["#2A7E4F","#3C8E60","#4E9E72","#6AAF8E","#8CC3A8","#A9D3BF","#C5E0D2","#D6E9DF","#E3F0E9"][i] || "#C5E0D2"
    }));

    const attendee = (t, pk) => {
      const p = this.P(pk) || {name:"Unknown", nesrId:"—", title:"", dept:""};
      const key = t.id + ":" + pk;
      const mark = st.attended[key]; // true = attended, false = no show, undefined = not marked yet
      return {
        name: p.name, initials: initialsOf(p.name),
        meta: [p.nesrId && p.nesrId !== "—" ? "NESR ID " + p.nesrId : "", p.title, p.dept].filter(Boolean).join(" · "),
        label: mark === true ? "Attended" : mark === false ? "No show" : "Mark attended",
        bg: mark === true ? "#C5E0D2" : "#FFFFFF",
        fg: mark === true ? "#1F5E3A" : mark === false ? "#8A2B2B" : "#58595B",
        border: mark === true ? "#2A7E4F" : "#D1D3D4",
        onToggle: () => this.act(() => actions.setAttendance(t.id, pk, mark !== true))
      };
    };

    const delivered = st.trainings.filter(t => t.start <= TODAY);
    const attendanceSessions = delivered.map(t => {
      const booked = st.requests.filter(r => r.tid === t.id && (r.state === "enrolled" || r.state === "completed")).map(r => r.who);
      const people = booked.map(pk => attendee(t, pk));
      const n = people.filter(p => p.label === "Attended").length;
      return {code: t.code, title: t.title, meta: this.range(t) + " · " + t.location,
        completionLabel: n + " of " + people.length + " completed", people};
    }).filter(a => a.people.length > 0);

    const templates = (st.templateRows || []).map(t => {
      const off = st.templatesOff[t.id];
      return Object.assign({}, t, {
        state: off ? "Paused" : "Active", stBg: off ? "#EEF1EF" : "#C5E0D2", stFg: off ? "#58595B" : "#1F5E3A",
        toggleLabel: off ? "Activate" : "Pause",
        onEdit: () => this.setState({editor: Object.assign({}, t, {kind: "template", heading: "Edit Template", cta: "Save Template"})}),
        onToggle: () => this.act(() => actions.setTemplateActive(t.id, !!off), off ? "Template activated" : "Template paused", t.name)
      });
    });

    const teamStats = myReports.map(k => {
      const p = this.P(k);
      const reqs = st.requests.filter(r => r.who === k && r.state !== "rejected")
        .map(r => ({r, t: this.t(r.tid)})).filter(x => x.t)
        .sort((a, b) => a.t.start < b.t.start ? 1 : -1);
      const attended = x => st.attended[x.t.id + ":" + k] === true;
      const nAttended = reqs.filter(attended).length;
      const open = !!st.teamOpen[k];
      return {
        name: p.name, role: [p.title, (p.loc || "").split(",")[0]].filter(Boolean).join(" · "), initials: initialsOf(p.name),
        label: reqs.length + (reqs.length === 1 ? " training" : " trainings"), sub: nAttended + " attended",
        open, chevron: open ? "▾" : "▸", rowBg: open ? "#F7F9F8" : "#FFFFFF",
        onToggle: () => this.setState({teamOpen: Object.assign({}, st.teamOpen, {[k]: !open})}),
        noTrainings: reqs.length === 0,
        trainings: reqs.map(x => {
          const base = STATE_STYLE[x.r.state] || STATE_STYLE.pending;
          return {title: x.t.code + " · " + x.t.title, meta: this.range(x.t) + " · " + x.t.location,
            status: base.label, stBg: base.bg, stFg: base.fg, attended: attended(x)};
        })
      };
    });

    const myUpcoming = myRequests.filter(r => r.state === "enrolled").length;
    const myDays = st.requests.filter(r => r.who === meP.key && (r.state === "enrolled" || r.state === "completed"))
      .reduce((a, r) => { const tt = this.t(r.tid); return a + (tt ? this.days(tt) : 0); }, 0);
    const empKpis = [
      {label:"Enrolled", value: String(myUpcoming), note:"Confirmed sessions"},
      {label:"Awaiting Approval", value: String(mineOpen), note:"In the approval chain"},
      {label:"Completed", value: String(st.requests.filter(r => r.who === meP.key && r.state === "completed").length), note: YEAR + " cycle"},
      {label:"Training Days", value: String(myDays), note:"Target 10 days"}
    ];

    // ---- Send Training Email ----
    const m = st.mail;
    const mailInfo = st.mailInfo || {from: "", configured: false};
    const trainingOptions = [{value: "", label: "Select a training"}].concat(upcoming.map(t => ({value: t.id, label: t.code + " · " + t.title + " (" + this.range(t) + ")"})));
    const mailCount = m.trainingId ? audienceIds(m.audience, m.trainingId, st.requests, st.attended).length : 0;
    const audienceLabel = (AUDIENCES.find(a => a.value === m.audience) || AUDIENCES[0]).label.toLowerCase();
    const canSend = mailInfo.configured && mailCount > 0 && m.subject.trim() && m.body.trim() && !st.busy;
    const mail = {
      selects: [
        {label: "Training", span: "1 / -1", value: m.trainingId, options: trainingOptions, onChange: e => this.setMail({trainingId: e.target.value})},
        {label: "Send to", span: "auto", value: m.audience, options: AUDIENCES, onChange: e => this.setMail({audience: e.target.value})},
        {label: "Start from template", span: "auto", value: m.templateId,
          options: [{value: "", label: "Blank"}].concat((st.templateRows || []).map(t => ({value: t.id, label: t.name}))),
          onChange: e => {
            const tpl = (st.templateRows || []).find(t => t.id === e.target.value);
            this.setMail(tpl ? {templateId: tpl.id, subject: tpl.subject, body: tpl.body} : {templateId: ""});
          }}
      ],
      recipientLabel: !m.trainingId ? "Select a training to see how many people will receive this email."
        : mailCount ? mailCount + (mailCount === 1 ? " person" : " people") + " (" + audienceLabel + ") will receive this email."
        : "No one in this group for this training yet.",
      recipientBg: mailCount ? "#F2F7F4" : "#F7F9F8", recipientBorder: mailCount ? "#D9E7E0" : "#EAEEEC", recipientFg: mailCount ? "#1F5E3A" : "#8A8F8C",
      subject: m.subject, body: m.body,
      onSubject: e => this.setMail({subject: e.target.value}), onBody: e => this.setMail({body: e.target.value}),
      placeholders: PLACEHOLDERS.join(" "),
      fromLabel: mailInfo.configured ? "From: " + mailInfo.from : "Sending isn't set up yet (needs LD_MAIL_FROM and LD_N8N_EMAIL_WEBHOOK_URL in Vercel).",
      buttonLabel: st.busy ? "Sending…" : mailCount ? "Send to " + mailCount : "Send",
      buttonBg: canSend ? "#2A7E4F" : "#A8ACAA", buttonCursor: canSend ? "pointer" : "not-allowed",
      onSubmit: () => {
        if (!canSend) {
          if (!mailInfo.configured) return this.flash("Email not set up", "Ask whoever manages Vercel to set LD_MAIL_FROM and LD_N8N_EMAIL_WEBHOOK_URL.");
          if (!m.trainingId || !mailCount) return this.flash("No recipients", "Choose a training and a group that has people in it.");
          return this.flash("Message incomplete", "Write a subject and a message first.");
        }
        if (!window.confirm("Send this email to " + mailCount + (mailCount === 1 ? " person" : " people") + "?")) return;
        this.act(() => actions.sendTrainingEmail({trainingId: m.trainingId, audience: m.audience, subject: m.subject, body: m.body}),
          "Email sent", mailCount + (mailCount === 1 ? " email" : " emails") + " handed to the mail service from " + mailInfo.from + ".");
      }
    };

    // ---- Nameplate Generator ----
    const pl = st.plate;
    const pt = pl.trainingId ? this.t(pl.trainingId) : null;
    const ptReqs = pt ? st.requests.filter(r => r.tid === pt.id && ENROLLED_STATES.includes(r.state)) : [];
    const nAttended = pt ? audienceIds("participants", pt.id, st.requests, st.attended).length : 0;
    const nEnrolled = pt ? audienceIds("enrolled", pt.id, st.requests, st.attended).length : 0;
    const whoOptions = [
      {value: "participants", label: "All participants (attended) — " + nAttended},
      {value: "enrolled", label: "All enrolled — " + nEnrolled}
    ].concat(ptReqs.map(r => this.P(r.who)).filter(Boolean).sort((a, b) => a.name < b.name ? -1 : 1).map(p => ({value: p.key, label: p.name})))
     .concat([{value: "custom", label: "Someone else (type a name)"}]);
    const plateCount = !pt ? 0 : pl.who === "participants" ? nAttended : pl.who === "enrolled" ? nEnrolled : pl.who === "custom" ? (pl.customName.trim() ? 1 : 0) : 1;
    const pFrom = pl.from || (pt ? pt.start : ""), pTo = pl.to || (pt ? pt.end : "");
    const plateDate = pFrom ? dateRange(pFrom, pTo && pTo >= pFrom ? pTo : pFrom) : "";
    const canPlate = !!pt && plateCount > 0 && !st.busy;
    const plate = {
      selects: [
        {label: "Training", span: "1 / -1", value: pl.trainingId, options: trainingOptions, onChange: e => this.setPlate({trainingId: e.target.value, from: "", to: ""})},
        {label: "Nameplate for", span: "1 / -1", value: pl.who, options: whoOptions, onChange: e => this.setPlate({who: e.target.value})}
      ],
      showCustom: pl.who === "custom", customName: pl.customName, onCustomName: e => this.setPlate({customName: e.target.value}),
      from: pFrom, to: pTo, onFrom: e => this.setPlate({from: e.target.value}), onTo: e => this.setPlate({to: e.target.value}),
      summary: !pt ? "Select a training to start." : plateCount ? plateCount + (plateCount === 1 ? " nameplate" : " nameplates") + " · one A4 landscape page each, fold along the dashed line." : "No one to print for this choice.",
      buttonLabel: st.busy ? "Preparing…" : "Download PDF",
      buttonBg: canPlate ? "#2A7E4F" : "#A8ACAA", buttonCursor: canPlate ? "pointer" : "not-allowed",
      onSubmit: () => {
        if (!canPlate) return this.flash("Nothing to print", pt ? "Choose people who have a name to print." : "Select a training first.");
        this.downloadPlates({trainingId: pt.id, who: pl.who, customName: pl.customName, date: plateDate},
          plateCount + (plateCount === 1 ? " nameplate" : " nameplates") + " for " + pt.code + " downloaded.");
      }
    };

    let session = null;
    if (s.aSession) {
      const t = this.t(st.sessionId);
      if (t) {
        const reqs = st.requests.filter(r => r.tid === t.id);
        const by = k => reqs.filter(r => r.state === k);
        const ss = this.seatState(t);
        const startMs = isoMs(t.start), endMs = isoMs(t.end), todayMs = isoMs(TODAY);
        const dleft = Math.round((startMs - todayMs) / 86400000);
        const dsince = Math.round((todayMs - endMs) / 86400000);
        const isDelivered = todayMs > endMs;
        const live = !isDelivered && dleft <= 0;
        const countBig = isDelivered ? "Delivered" : live ? "In progress" : String(dleft);
        const countUnit = isDelivered ? (dsince === 0 ? "ended today" : dsince + " days ago") : live ? "running now" : (dleft === 1 ? "day to go" : "days to go");
        const reqEnrolled = by("enrolled").length + by("completed").length;
        const enrolledN = Math.max(t.enrolled, reqEnrolled);
        const inApproval = by("pending").length + by("lnd").length;
        const applied = enrolledN + inApproval + by("waitlist").length + by("rejected").length;
        const fillPct = Math.round(t.enrolled / Math.max(1, t.seats) * 100);
        const bar = (label, n, color) => ({label, n: String(n), pct: Math.round(n / Math.max(1, applied) * 100), color});
        const showAttendance = isDelivered || live;
        const registered = reqs.filter(r => REGISTERED_STATES.includes(r.state));
        const enrolledReqs = registered.filter(r => ENROLLED_STATES.includes(r.state));
        const attendedReqs = registered.filter(r => st.attended[t.id + ":" + r.who] === true);
        const registeredRows = registered.map(r => {
          const base = STATE_STYLE[r.state] || STATE_STYLE.pending;
          return Object.assign(attendee(t, r.who), {badge: base.label, badgeBg: base.bg, badgeFg: base.fg,
            showToggle: showAttendance && ENROLLED_STATES.includes(r.state)});
        });
        const participantRows = attendedReqs.map(r => Object.assign(attendee(t, r.who),
          {badge: "Attended", badgeBg: "#C5E0D2", badgeFg: "#1F5E3A", showToggle: false}));
        const onParticipants = st.rosterTab === "participants";
        const roster = onParticipants ? participantRows : registeredRows;
        const attendedN = attendedReqs.length;
        const tabBtn = (k, label) => ({label, bg: st.rosterTab === k ? "#FFFFFF" : "transparent", fg: st.rosterTab === k ? "#2A7E4F" : "#58595B",
          onClick: () => this.setState({rosterTab: k})});
        session = {
          code: t.code, title: t.title, photo: this.photoFor(t),
          meta: [t.category, t.type, t.instructor].filter(Boolean).join(" · "),
          dates: this.range(t), location: t.location, duration: this.days(t) + " days",
          desc: t.desc, statusLabel: ss.label, statusBg: ss.bg, statusFg: ss.fg,
          countBig, countUnit,
          kpis: [
            {label:"Applications", value: String(applied), note:"All time"},
            {label:"In Approval", value: String(inApproval), note: by("pending").length + " with managers"},
            {label:"Enrolled", value: String(enrolledN), note:"Confirmed seats"},
            {label:"Waitlisted", value: String(by("waitlist").length), note:"Next in line"},
            {label:"Declined", value: String(by("rejected").length), note:"Not approved"},
            {label:"Seat Fill", value: fillPct + "%", note: t.enrolled + " of " + t.seats + " seats"}
          ],
          fillPct: String(Math.min(100, fillPct)), fillColor: fillPct >= 100 ? "#58595B" : fillPct >= 80 ? "#6AAF8E" : "#2A7E4F",
          fillLabel: t.enrolled + " of " + t.seats + " seats taken",
          funnel: [
            bar("Applied", applied, "#2A7E4F"),
            bar("Manager approved", by("lnd").length + enrolledN, "#3C8E60"),
            bar("Awaiting manager", by("pending").length, "#B07A00"),
            bar("Enrolled", enrolledN, "#6AAF8E"),
            bar("Waitlisted", by("waitlist").length, "#A9D3BF"),
            bar("Declined", by("rejected").length, "#C9CDCB")
          ],
          pending: by("pending").concat(by("lnd")).map(decorate),
          hasPending: inApproval > 0, noPending: inApproval === 0,
          rosterTabs: [tabBtn("registered", "Registered (" + registered.length + ")"), tabBtn("participants", "Participants (" + attendedN + ")")],
          roster, hasRoster: roster.length > 0, noRoster: roster.length === 0,
          rosterEmpty: onParticipants
            ? (showAttendance ? "No one has been marked as attended yet. Mark attendance on the Registered tab." : "Attendance can be marked once the session starts.")
            : "No one has registered for this session yet.",
          rosterNote: !onParticipants && enrolledReqs.length < t.enrolled ? (t.enrolled - enrolledReqs.length) + " further seats were enrolled directly by the L&D team" : "",
          hasRosterNote: !onParticipants && enrolledReqs.length < t.enrolled,
          showAttendance,
          completionLabel: attendedN + " of " + enrolledReqs.length + " marked attended",
          onBack: () => this.setState({screen:"trainings", sessionId: null}),
          onEdit: () => this.setState({editorError: false, editor: Object.assign({}, t, {heading:"Edit Training", cta:"Save Changes"})}),
          onExport: () => this.flash("Export coming soon", t.code + " participant export is not wired up yet.")
        };
      }
    }

    return {
      session,
      user: {name: meP.name, first: meP.first, initials: initialsOf(meP.name),
        sub: [meP.title, meP.nesrId && meP.nesrId !== "—" ? "NESR ID " + meP.nesrId : ""].filter(Boolean).join(" · ")},
      onSignOut: () => actions.logout(),
      year: YEAR, nav, s,
      rows, adminRows, viewTabs, filters, q: st.q,
      onSearch: e => this.setState({q: e.target.value}),
      clearFilters: () => this.setState({q:"", fType:"All", fCat:"All", fLoc:"All", fSeats:"All"}),
      isTable: st.calView === "table", isMonth: st.calView === "month", isCards: st.calView === "cards",
      noResults: rows.length === 0,
      resultLabel: rows.length + " of " + st.trainings.length + " sessions in the calendar",
      catalogLabel: st.trainings.length + " sessions published",
      pendingLabel: onMe + " request" + (onMe === 1 ? "" : "s") + " waiting on you · once you approve, each request moves to the next approver in the chain, then the L&D team",
      dayNames: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],
      monthCells, monthLabel: MONTHS[st.month] + " " + st.calYear,
      prevMonth: () => this.setState(st.month === 0 ? {month: 11, calYear: st.calYear - 1} : {month: st.month - 1}),
      nextMonth: () => this.setState(st.month === 11 ? {month: 0, calYear: st.calYear + 1} : {month: st.month + 1}),
      empty: {
        myRequests: myRequests.length === 0, teamRequests: teamRequests.length === 0, teamStats: teamStats.length === 0,
        queueRows: queueRows.length === 0, attendance: attendanceSessions.length === 0
      },
      myRequests, teamRequests, queueRows, recommended, teamStats,
      empKpis, adminKpis, fillRows, catRows, attendanceSessions, templates, ageingRows, timelineRows,
      resources: RESOURCES,
      detail, formFields, justification: st.justification,
      onJustification: e => this.setState({justification: e.target.value}),
      submitRequest: () => this.submitRequest(),
      mail, plate,
      editor: st.editor && Object.assign({}, st.editor, {cta: st.busy ? "Saving…" : st.editor.cta}), editorFields, saveTraining: () => this.saveTraining(),
      onNewTraining: () => this.setState({editorError: false, editor: {heading:"Add Training", cta:"Publish Session", code:"", title:"", category:"", type:"", start:"", end:"", location:"", seats:"", instructor:"", desc:""}}),
      onExport: () => this.flash("Export coming soon", "The registration report export is not wired up yet."),
      closeModal: () => this.setState({detailId: null, editor: null, editorError: false}),
      stop: e => e.stopPropagation(),
      toast: st.toast
    };
  }

  render() { return <PortalView v={this.renderVals()} />; }
}
