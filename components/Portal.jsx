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
  pending:   {label:"Awaiting Manager",  bg:"#FDF2D9", fg:"#8A6100"},
  enrolled:  {label:"Enrolled",          bg:"#C5E0D2", fg:"#1F5E3A"},
  waitlist:  {label:"Waitlisted",        bg:"#E3EEFA", fg:"#1F4E79"},
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
      rejectFor: null, rejectText: "", rejectError: false,
      dashCard: null,
      editorError: false,
      screen: "dashboard",
      calView: "table",
      month: now.getMonth(), calYear: now.getFullYear(),
      q: "", fType: "All", fCat: "All", fLoc: "All", addValue: "",
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
      templatesOff: d.templatesOff, templateRows: d.templates, mailInfo: d.mail, directory: d.directory || []
    };
  }

  componentWillUnmount() { clearTimeout(this._tt); }

  flash(title, body) {
    clearTimeout(this._tt);
    this.setState({toast: {title, body}});
    this._tt = setTimeout(() => this.setState({toast: null}), 4200);
  }

  /** Calls a server action, swaps in the fresh data and shows a toast. */
  async act(promiseFn, title, body, extra, op = "action") {
    if (this.state.busy) return;
    this.setState({busy: true, busyOp: op});
    try {
      const res = await promiseFn();
      if (res.ok) {
        this.setState(Object.assign(this.fromSnapshot(res.data), extra || {}, {busy: false, busyOp: null}));
        // title may be a function of the fresh data returning [title, body]
        const [tt, bb] = typeof title === "function" ? title(res.data) : [title, body];
        if (tt) this.flash(tt, bb);
      } else {
        this.setState({busy: false, busyOp: null});
        this.flash("Couldn't save that change", res.error);
      }
    } catch (e) {
      this.setState({busy: false, busyOp: null});
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

  regStyle(t) {
    return t.registrationOpen
      ? {label: "Registration open", bg: "#C5E0D2", fg: "#1F5E3A"}
      : {label: "Registration closed", bg: "#EEF1EF", fg: "#58595B"};
  }

  row(t, i) {
    const reg = this.regStyle(t);
    return {
      id: t.id, code: t.code, title: t.title, category: t.category, type: t.type,
      dates: this.range(t), location: t.location, st: reg, photo: this.photoFor(t), closed: !t.registrationOpen,
      duration: this.days(t) + (this.days(t) === 1 ? " day" : " days"),
      zebra: i % 2 ? "#FAFBFA" : "#FFFFFF",
      cta: t.registrationOpen ? "Register →" : "View details →",
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
    const blank = v => !String(v ?? "").trim();
    const missing = [blank(form.nesrId) && "NESR ID", blank(form.name) && "full name", !form.loc && "work location", !form.dept && "department",
      !form.nat && "nationality", !chain.length && !/^[^@ ]+@[^@ ]+[.][^@ ]+$/.test(String(form.mgr || "").trim()) && "approver email",
      blank(this.state.justification) && "business justification"].filter(Boolean);
    if (missing.length) {
      this.setState({formError: true});
      this.flash("Some details are missing", "Please fill in: " + missing.join(", ") + ".");
      return;
    }
    const next = chain.length ? this.P(chain[0]) : null;
    this.act(() => actions.submitRequest({trainingId: t.id, justification: this.state.justification, form}),
      "Request submitted",
      "Sent to " + (next ? next.name + (next.title ? " (" + next.title + ")" : "") : form.mgr) +
        " for approval. Once approved you're enrolled, or waitlisted if the class is full or registration has closed.",
      {detailId: null, justification: "", formError: false});
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
  /** Opens or closes registration for a training (L&D). */
  toggleRegistration(t) {
    const open = !t.registrationOpen;
    if (!open && !window.confirm("Close registration for " + t.code + "? Employees can't request it any more, and managers' approvals from now on go to the waitlist.")) return;
    this.act(() => actions.setRegistrationOpen(t.id, open),
      open ? "Registration re-opened" : "Registration closed",
      t.code + (open ? " is open for requests again." : " no longer accepts requests."));
  }

  /** Downloads a file (e.g. a PDF) from a GET endpoint. */
  async downloadFile(url, label) {
    if (this.state.busy) return;
    this.setState({busy: true, busyOp: "download"});
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        this.flash("Couldn't create the file", err.error || "Try again in a moment.");
        return;
      }
      const blob = await res.blob();
      const match = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = match ? match[1] : "download.pdf";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      this.flash("Download ready", label);
    } catch {
      this.flash("Couldn't reach the server", "Check your connection and try again.");
    } finally {
      this.setState({busy: false, busyOp: null});
    }
  }

  async downloadPlates(body, label) {
    if (this.state.busy) return;
    this.setState({busy: true, busyOp: "plate"});
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
      this.setState({busy: false, busyOp: null});
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
    const waitlistAll = st.requests.filter(r => r.state === "waitlist").length;
    const onMe = st.requests.filter(r => r.state === "pending" && (r.chain || [])[r.step] === meP.key).length;
    const mineOpen = st.requests.filter(r => r.who === meP.key && r.state === "pending").length;
    const badges = {approvals: onMe, queue: waitlistAll, dashboard: mineOpen};

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
    const nav = section("Employee", [["dashboard","My Dashboard"],["calendar","Training Calendar"],["resources","Resources"]], true)
      .concat(canManage ? section("Manager", [["approvals","Team Approvals"],["team","Team Development"]]) : [])
      .concat(isAdmin ? section("L&D Team", [["adminDash","Dashboard"],["trainings","Manage Trainings"],["queue","Waitlist Queue"],["attendance","Attendance"],["templates","Notifications"]]) : []);

    const s = {
      empDash: scr === "dashboard",
      cal: scr === "calendar",
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

    const typeTabs = ["All"].concat(TYPES).map(k => ({
      label: k, bg: st.fType === k ? "#FFFFFF" : "transparent", fg: st.fType === k ? "#2A7E4F" : "#58595B",
      onClick: () => this.setState({fType: k})
    }));
    const filters = [
      {label:"Category", value: st.fCat, options:["All"].concat(CATEGORIES), onChange: e => this.setState({fCat: e.target.value})},
      {label:"Location", value: st.fLoc, options:["All"].concat(LOCATIONS), onChange: e => this.setState({fLoc: e.target.value})}
    ];

    const first = new Date(st.calYear, st.month, 1).getDay();
    const dim = new Date(st.calYear, st.month + 1, 0).getDate();
    const monthCells = [];
    for (let i = 0; i < first; i++) monthCells.push({day:"", items:[], bg:"#FAFBFA", numFg:"#C9CDCB"});
    for (let d = 1; d <= dim; d++) {
      const items = st.trainings.filter(t => this.yearOf(t.start) === st.calYear && this.monNum(t.start) === st.month && this.dayNum(t.start) === d).map(t => {
        return {label: t.code + " · " + t.title, bg: t.registrationOpen ? "#2A7E4F" : "#8A8F8C", onClick: () => this.openDetail(t.id)};
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
      const outcome = {enrolled: "Enrolled", completed: "Completed", waitlist: "Waitlisted"}[r.state] || "Confirmed";
      const stepDefs = [{label:"Submitted", note: r.submitted}]
        .concat(chainPeople.map(p => ({label: p.first + " (manager)", note: p.title})))
        .concat([{label: outcome, note: r.state === "waitlist" ? "Class full or registration closed" : "Seat confirmed"}]);
      const failIdx = r.state === "rejected" ? 1 + r.step : -1;
      const prog = r.state === "rejected" || r.state === "pending" ? 1 + r.step : stepDefs.length;
      const steps = stepDefs.map((d, i) => {
        const failed = i === failIdx;
        const active = i < prog;
        const waitStep = r.state === "waitlist" && i === stepDefs.length - 1;
        return {
          label: d.label,
          note: failed ? "Declined" : i === 0 ? r.submitted : waitStep ? d.note : active ? "Done" : (i === prog && r.state === "pending" ? "Awaiting" : ""),
          bar: failed ? "#8A2B2B" : waitStep ? "#1F4E79" : active ? "#2A7E4F" : "#E1E5E3",
          fg: failed ? "#8A2B2B" : waitStep ? "#1F4E79" : active ? "#1F5E3A" : "#A8ACAA"
        };
      });
      const approverP = chainPeople[chainPeople.length - 1];
      const nextIdx = r.step + 1;
      return {
        id: r.id, code: t.code, title: t.title, employee: name, initials: initialsOf(name),
        empMeta: "NESR ID " + (form.nesrId || person.nesrId) + " · " + person.title + " · " + (form.loc || person.loc),
        manager: cur ? cur.name + (cur.title ? " (" + cur.title + ")" : "") : chainPeople.length ? chainPeople[chainPeople.length - 1].name : "—",
        chainNote: chainPeople.map(p => p.first).join(" → ") || "—",
        approver: approverP ? approverP.name + (approverP.title ? " (" + approverP.title + ")" : "") : (form.mgr || "Added by the L&D team"),
        justification: r.justification,
        meta: this.range(t) + " · " + t.location + " · submitted " + r.submitted,
        st: {label: r.state === "pending" ? (cur ? "Awaiting " + cur.first : "Awaiting Manager") : base.label, bg: base.bg, fg: base.fg},
        state: r.state, stage: r.state, steps,
        actionable: r.state === "pending" && (r.chain || [])[r.step] === meP.key,
        onApprove: () => this.act(() => actions.approveRequest(r.id), data => {
          const after = data.requests.find(x => x.id === r.id);
          if (after && after.state === "enrolled") return ["Approved — enrolled", name + " is enrolled in " + t.code + "."];
          if (after && after.state === "waitlist") return ["Approved — waitlisted", name + " is on the waitlist for " + t.code + " (class full or registration closed). L&D can enroll them."];
          return ["Approved", nextIdx < chainPeople.length ? name + " approved — routed to " + chainPeople[nextIdx].name + "." : name + " approved."];
        }),
        // Manager decline: opens a comment box; the reason is required and goes to the employee
        employeeFirst: (person.first || name.split(" ")[0]),
        comment: r.comment || "",
        rejecting: st.rejectFor === r.id,
        rejectText: st.rejectFor === r.id ? st.rejectText : "",
        rejectBorder: st.rejectFor === r.id && st.rejectError ? "#8A2B2B" : "#D1D3D4",
        rejectCta: st.busyOp === "action" && st.rejectFor === r.id ? "Declining…" : "Decline request",
        onRejectText: e => this.setState({rejectText: e.target.value, rejectError: false}),
        onCancelReject: () => this.setState({rejectFor: null, rejectText: "", rejectError: false}),
        onReject: () => this.setState({rejectFor: r.id, rejectText: "", rejectError: false}),
        onConfirmReject: () => {
          const reason = st.rejectText.trim();
          if (reason.length < 3) {
            this.setState({rejectError: true});
            return this.flash("Reason needed", "Please add a short reason so " + (person.first || name) + " knows why.");
          }
          this.act(() => actions.rejectRequest(r.id, reason), "Request declined",
            name + "'s request for " + t.code + " was declined. They'll be emailed with your reason.",
            {rejectFor: null, rejectText: "", rejectError: false});
        },
        onEnroll: () => {
          const full = t.enrolled >= t.seats;
          if (full && !window.confirm(t.code + " is full (" + t.enrolled + " of " + t.seats + " seats). Enroll " + name + " anyway?")) return;
          this.act(() => actions.enrollRequest(r.id), "Participant enrolled", name + " is enrolled in " + t.code + ".");
        },
        onDecline: () => this.act(() => actions.rejectRequest(r.id), "Request declined", name + "'s request for " + t.code + " was declined.")
      };
    };

    const myRequests = st.requests.filter(r => r.who === meP.key).map(decorate);
    const teamRequests = st.requests.filter(r => (r.chain || []).indexOf(meP.key) >= 0).map(decorate)
      .sort((a, b) => (b.actionable ? 1 : 0) - (a.actionable ? 1 : 0));
    const queueRows = st.requests.filter(r => r.state === "waitlist")
      .map((r, i) => Object.assign(decorate(r), {zebra: i % 2 ? "#FAFBFA" : "#FFFFFF"}));

    const upcoming = st.trainings.slice().sort((a, b) => a.start < b.start ? -1 : 1);

    const myForm = st.form || this.defaultForm();
    const detailT = st.detailId ? this.t(st.detailId) : null;
    let detail = null, formFields = [];
    if (detailT) {
      const already = st.requests.some(r => r.who === meP.key && r.tid === detailT.id);
      const canApply = !already && detailT.registrationOpen;
      const myChain = this.chainFor(meP.key).map(k => this.P(k));
      const chainNote = "Approval: " + (myChain.length
        ? myChain.map(p => p.first + (p.title ? " (" + p.title + ")" : "")).join(" → ")
        : myForm.mgr || "your line manager") + " — final approval";
      // (approval chain note above uses first names; the Approver field below shows the full name)
      detail = {
        code: detailT.code, type: detailT.type, title: detailT.title, desc: detailT.desc, photo: this.photoFor(detailT),
        canApply,
        width: canApply ? "900px" : "600px",
        railBg: canApply ? "#FAFBFA" : "#FFFFFF",
        railBorder: canApply ? "1px solid #EAEEEC" : "0",
        ctaLabel: st.busyOp === "action" ? "Submitting…" : "Submit Request",
        chainNote,
        footNote: already ? "You already have a request on file for this session." :
          !detailT.registrationOpen ? "Registration for this session is closed." : "All fields are required.",
        facts: [
          mk("Dates", this.range(detailT), "M7 3v3M17 3v3M4 9.5h16M5.5 6h13a1.5 1.5 0 011.5 1.5v11A1.5 1.5 0 0118.5 20h-13A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6z"),
          mk("Duration", this.days(detailT) + " days", "M12 21a9 9 0 100-18 9 9 0 000 18zM12 7.5V12l3 2"),
          mk("Location", detailT.location, "M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11zM12 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"),
          mk("Category", detailT.category, "M4 6.5h5l2 2h9v9.5a1 1 0 01-1 1H5a1 1 0 01-1-1z"),
          mk("Instructor", detailT.instructor || "TBC", "M12 12a4 4 0 100-8 4 4 0 000 8zM4.5 20c0-3.3 3.4-5.5 7.5-5.5s7.5 2.2 7.5 5.5"),
          mk("Registration", detailT.registrationOpen ? "Open" : "Closed", "M20 6.5L9.5 17 4.5 12")
        ]
      };
      const field = f => Object.assign({border:"#D9DDDB", fg:"#1F1F1D", bg:"#fff", readOnly:false, hint:"", choosePrompt:""}, f);
      const lockedMgr = myChain.length ? myChain[0] : null;
      const natMissing = st.formError && !myForm.nat;
      const reqText = (label, key, extra) => {
        const bad = st.formError && !String(myForm[key] || "").trim();
        return field(Object.assign({label: label + " *", isText: true, value: myForm[key], onChange: this.setForm(key),
          border: bad ? "#8A2B2B" : "#D9DDDB", hint: bad ? "Required" : ""}, extra));
      };
      formFields = [
        reqText("NESR ID", "nesrId", {placeholder: "e.g. 10428"}),
        reqText("Full name", "name", {placeholder: "Full name"}),
        field({label:"Work location *", isSelect:true, value: myForm.loc, options: withOption(LOCATIONS, myForm.loc), onChange: this.setForm("loc"),
          choosePrompt:"Select from dropdown", fg: myForm.loc ? "#1F1F1D" : "#8A8F8C",
          border: st.formError && !myForm.loc ? "#8A2B2B" : "#D9DDDB", hint: st.formError && !myForm.loc ? "Required" : ""}),
        field({label:"Department *", isSelect:true, value: myForm.dept, options: withOption(DEPTS, myForm.dept), onChange: this.setForm("dept"),
          choosePrompt:"Select from dropdown", fg: myForm.dept ? "#1F1F1D" : "#8A8F8C",
          border: st.formError && !myForm.dept ? "#8A2B2B" : "#D9DDDB", hint: st.formError && !myForm.dept ? "Required" : ""}),
        field({label:"Nationality (visa) *", isSelect:true, value: myForm.nat, options: NATIONALITIES, onChange: this.setForm("nat"),
          choosePrompt:"Select from dropdown", fg: myForm.nat ? "#1F1F1D" : "#8A8F8C",
          border: natMissing ? "#8A2B2B" : "#D9DDDB", hint: natMissing ? "Required" : ""}),
        lockedMgr
          ? field({label:"Approver *", isText:true, value: lockedMgr.name + (lockedMgr.title ? " (" + lockedMgr.title + ")" : ""), readOnly:true, bg:"#F2F4F3", fg:"#58595B", onChange: () => {},
              hint:"Your line manager, from your Microsoft profile. If it's wrong, ask HR to update it."})
          : reqText("Approver email", "mgr", {placeholder: "name@nesr.com",
              hint: st.formError && !String(myForm.mgr || "").trim() ? "Required" : "No manager is listed on your Microsoft profile. Enter who should approve."})
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
      rf({label:"Registration", isSelect:true, span:"auto", value: ed.registration, options: ["Open", "Closed"], onChange: this.setEditor("registration")}, ed.registration),
      rf({label:"Description", isTextarea:true, rows:"3", span:"1 / -1", value: ed.desc, placeholder:"What participants will learn", onChange: this.setEditor("desc")}, ed.desc)
    ];

    const adminRows = list.map((t, i) => {
      const r = this.row(t, i);
      r.onClick = () => this.setState({screen:"session", sessionId: t.id, rosterTab: "registered"});
      r.onView = () => this.setState({screen:"session", sessionId: t.id, rosterTab: "registered"});
      r.onEdit = () => this.setState({editorError: false, editor: Object.assign({}, t, {registration: t.registrationOpen ? "Open" : "Closed", heading:"Edit Training", cta:"Save Changes"})});
      // L&D sees seats here (employees don't)
      const left = Math.max(0, t.seats - t.enrolled);
      r.seatsLabel = t.enrolled + " / " + t.seats + (left ? " · " + left + " left" : " · full");
      r.seatFg = left ? "#1F5E3A" : "#8A2B2B";
      r.regLabel = t.registrationOpen ? "Open" : "Closed";
      r.regBg = t.registrationOpen ? "#C5E0D2" : "#EEF1EF"; r.regFg = t.registrationOpen ? "#1F5E3A" : "#58595B";
      r.regButton = t.registrationOpen ? "Close" : "Re-open";
      r.onToggleReg = () => this.toggleRegistration(t);
      r.onDelete = () => {
        const n = st.requests.filter(x => x.tid === t.id && ["pending", "enrolled", "waitlist"].includes(x.state)).length;
        if (!window.confirm("Delete " + t.code + " — " + t.title + "?" + (n ? "\n\n" + n + (n === 1 ? " registered person" : " registered people") + " will be emailed that it's cancelled." : ""))) return;
        this.act(() => actions.deleteTraining(t.id), "Training deleted",
          t.code + " was removed from the calendar" + (n ? " and " + n + (n === 1 ? " person was" : " people were") + " notified." : "."));
      };
      return r;
    });

    const openReqs = st.requests.filter(r => r.state === "pending");
    const ages = openReqs.map(r => this.ageDays(r));
    const avgWait = ages.length ? Math.round(ages.reduce((a, b) => a + b, 0) / ages.length) : 0;
    const oldestWait = ages.length ? Math.max.apply(null, ages) : 0;
    const slaColor = d => d >= 7 ? "#8A2B2B" : d >= 4 ? "#B07A00" : "#2A7E4F";

    const groups = {};
    openReqs.forEach(r => {
      const k = (r.chain || [])[r.step] || "none";
      const who = this.P(k) || {name:"Unknown approver", title:""};
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
      Object.assign({label:"Enrolled", color:"#2A7E4F"}, stageAvg(["enrolled"])),
      Object.assign({label:"Waitlisted", color:"#58595B"}, stageAvg(["waitlist"])),
      Object.assign({label:"Declined", color:"#8A2B2B"}, stageAvg(["rejected"]))
    ];

    const totalSeats = st.trainings.reduce((a, t) => a + t.seats, 0);
    const totalEnrolled = st.trainings.reduce((a, t) => a + t.enrolled, 0);
    const adminKpis = [
      {label:"Active Sessions", value: String(st.trainings.length), note: YEAR + " calendar"},
      {label:"Seat Utilization", value: Math.round(totalEnrolled / Math.max(1, totalSeats) * 100) + "%", note: totalEnrolled + " of " + totalSeats + " seats"},
      {label:"Pending Approvals", value: String(pendingAll), note: "With managers · " + waitlistAll + " waitlisted"},
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
        label: mark === true ? "Attended" : mark === false ? "No show" : "Not marked",
        // Two explicit buttons; the selected one is filled in
        attBg: mark === true ? "#2A7E4F" : "#FFFFFF", attFg: mark === true ? "#FFFFFF" : "#58595B",
        noBg: mark === false ? "#8A2B2B" : "#FFFFFF", noFg: mark === false ? "#FFFFFF" : "#58595B",
        onAttended: () => { if (mark !== true) this.act(() => actions.setAttendance(t.id, pk, true), "Marked attended", p.name + " · " + t.code); },
        onNoShow: () => { if (mark !== false) this.act(() => actions.setAttendance(t.id, pk, false), "Marked no show", p.name + " · " + t.code); }
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

    // ---- Dashboard cards: click to list the trainings behind each number ----
    const mine = st.requests.filter(r => r.who === meP.key)
      .map(r => ({r, t: this.t(r.tid), d: myRequests.find(x => x.id === r.id)})).filter(x => x.t && x.d)
      .sort((a, b) => a.t.start < b.t.start ? -1 : 1);
    const cardGroups = {
      enrolled: mine.filter(x => x.r.state === "enrolled"),
      pending: mine.filter(x => x.r.state === "pending"),
      completed: mine.filter(x => x.r.state === "completed")
    };
    const card = (key, label, value, note) => {
      const on = st.dashCard === key;
      return {label, value: String(value), note, bg: on ? "#F2F7F4" : "#FFFFFF", border: on ? "#2A7E4F" : "#E1E5E3",
        onClick: () => this.setState({dashCard: on ? null : key})};
    };
    const empKpis = [
      card("enrolled", "Enrolled", cardGroups.enrolled.length, "Confirmed sessions"),
      card("pending", "Awaiting Approval", cardGroups.pending.length, "With your manager"),
      card("completed", "Completed", cardGroups.completed.length, "Attended sessions")
    ];
    const LISTS = {
      enrolled: ["Enrolled trainings", "You're not enrolled in any training yet."],
      pending: ["Requests awaiting approval", "Nothing is waiting for approval."],
      completed: ["Completed trainings", "No completed trainings yet. A training counts as completed once L&D marks you as attended."]
    };
    const dashList = st.dashCard ? {
      title: LISTS[st.dashCard][0] + " (" + cardGroups[st.dashCard].length + ")",
      empty: cardGroups[st.dashCard].length === 0, emptyText: LISTS[st.dashCard][1],
      onClose: () => this.setState({dashCard: null}),
      rows: cardGroups[st.dashCard].map(x => ({
        title: x.t.code + " · " + x.t.title,
        meta: this.range(x.t) + " · " + x.t.location + " · submitted " + x.r.submitted,
        status: x.d.st.label, stBg: x.d.st.bg, stFg: x.d.st.fg
      }))
    } : null;

    // ---- Send Training Email ----
    const m = st.mail;
    const mailInfo = st.mailInfo || {from: "", configured: false};
    const trainingOptions = [{value: "", label: "Select a training"}].concat(upcoming.map(t => ({value: t.id, label: t.code + " · " + t.title + " (" + this.range(t) + ")"})));
    const mailCount = m.trainingId ? audienceIds(m.audience, m.trainingId, st.requests, st.attended).length : 0;
    const audienceLabel = (AUDIENCES.find(a => a.value === m.audience) || AUDIENCES[0]).label.toLowerCase();
    const canSend = mailInfo.configured && mailCount > 0 && m.subject.trim() && m.body.trim();
    const mailBusy = st.busyOp === "mail";
    const sender = mailInfo.from || "the Outlook account connected in n8n";
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
      fromLabel: !mailInfo.configured ? "Sending isn't set up yet (needs LD_N8N_EMAIL_WEBHOOK_URL in Vercel)."
        : "From: " + sender + (mailInfo.testRecipient ? "  ·  TEST MODE: every email goes to " + mailInfo.testRecipient : ""),
      buttonLabel: mailBusy ? "Sending…" : mailCount ? "Send to " + mailCount : "Send",
      buttonBg: canSend && !mailBusy ? "#2A7E4F" : "#A8ACAA", buttonCursor: canSend && !mailBusy ? "pointer" : "not-allowed",
      onSubmit: () => {
        if (st.busy) return;
        if (!canSend) {
          if (!mailInfo.configured) return this.flash("Email not set up", "Ask whoever manages Vercel to set LD_N8N_EMAIL_WEBHOOK_URL.");
          if (!m.trainingId || !mailCount) return this.flash("No recipients", "Choose a training and a group that has people in it.");
          return this.flash("Message incomplete", "Write a subject and a message first.");
        }
        const question = mailInfo.testRecipient
          ? "TEST MODE: send " + mailCount + (mailCount === 1 ? " email" : " emails") + " to " + mailInfo.testRecipient + " (instead of the real recipients)?"
          : "Send this email to " + mailCount + (mailCount === 1 ? " person" : " people") + "?";
        if (!window.confirm(question)) return;
        this.act(() => actions.sendTrainingEmail({trainingId: m.trainingId, audience: m.audience, subject: m.subject, body: m.body, templateId: m.templateId}),
          "Email sent", mailCount + (mailCount === 1 ? " email" : " emails") + " handed to n8n to send from " + sender +
          (mailInfo.testRecipient ? " — test mode, all delivered to " + mailInfo.testRecipient + "." : "."), null, "mail");
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
    const canPlate = !!pt && plateCount > 0;
    const plateBusy = st.busyOp === "plate";
    const plate = {
      selects: [
        {label: "Training", span: "1 / -1", value: pl.trainingId, options: trainingOptions, onChange: e => this.setPlate({trainingId: e.target.value, from: "", to: ""})},
        {label: "Nameplate for", span: "1 / -1", value: pl.who, options: whoOptions, onChange: e => this.setPlate({who: e.target.value})}
      ],
      showCustom: pl.who === "custom", customName: pl.customName, onCustomName: e => this.setPlate({customName: e.target.value}),
      from: pFrom, to: pTo, onFrom: e => this.setPlate({from: e.target.value}), onTo: e => this.setPlate({to: e.target.value}),
      summary: !pt ? "Select a training to start." : plateCount ? plateCount + (plateCount === 1 ? " nameplate" : " nameplates") + " · one A4 landscape page each, fold along the dashed line." : "No one to print for this choice.",
      buttonLabel: plateBusy ? "Preparing…" : "Download PDF",
      buttonBg: canPlate && !plateBusy ? "#2A7E4F" : "#A8ACAA", buttonCursor: canPlate && !plateBusy ? "pointer" : "not-allowed",
      onSubmit: () => {
        if (st.busy) return;
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
        const reg = this.regStyle(t);
        const startMs = isoMs(t.start), endMs = isoMs(t.end), todayMs = isoMs(TODAY);
        const dleft = Math.round((startMs - todayMs) / 86400000);
        const dsince = Math.round((todayMs - endMs) / 86400000);
        const isDelivered = todayMs > endMs;
        const live = !isDelivered && dleft <= 0;
        const countBig = isDelivered ? "Delivered" : live ? "In progress" : String(dleft);
        const countUnit = isDelivered ? (dsince === 0 ? "ended today" : dsince + " days ago") : live ? "running now" : (dleft === 1 ? "day to go" : "days to go");
        const enrolledN = by("enrolled").length + by("completed").length;
        const fillPct = Math.round(t.enrolled / Math.max(1, t.seats) * 100);
        const showAttendance = isDelivered || live;
        const registered = reqs.filter(r => REGISTERED_STATES.includes(r.state));
        const enrolledReqs = registered.filter(r => ENROLLED_STATES.includes(r.state));
        const attendedReqs = registered.filter(r => st.attended[t.id + ":" + r.who] === true);
        const registeredRows = registered.map(r => {
          const base = STATE_STYLE[r.state] || STATE_STYLE.pending;
          const who = (this.P(r.who) || {}).name || "this person";
          return Object.assign(attendee(t, r.who), {badge: base.label, badgeBg: base.bg, badgeFg: base.fg,
            showToggle: showAttendance && ENROLLED_STATES.includes(r.state),
            canRemove: true,
            onRemove: () => {
              if (!window.confirm("Remove " + who + " from " + t.code + "? Their registration is deleted and any seat is freed.")) return;
              this.act(() => actions.removeParticipant(r.id), "Removed", who + " was removed from " + t.code + ".");
            }});
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
          desc: t.desc, statusLabel: reg.label, statusBg: reg.bg, statusFg: reg.fg,
          regLabel: reg.label, regBg: reg.bg, regFg: reg.fg,
          regButton: t.registrationOpen ? "Close Registration" : "Re-open Registration",
          onToggleReg: () => this.toggleRegistration(t),
          countBig, countUnit,
          kpis: [
            {label:"Pending Approvals", value: String(by("pending").length), note:"Waiting on managers"},
            {label:"Enrolled", value: String(enrolledN), note: t.enrolled + " of " + t.seats + " seats taken"},
            {label:"Waitlisted", value: String(by("waitlist").length), note:"Manager approved, no seat"},
            {label:"Rejected", value: String(by("rejected").length), note:"Declined"}
          ],
          fillPct: String(Math.min(100, fillPct)), fillColor: fillPct >= 100 ? "#58595B" : fillPct >= 80 ? "#6AAF8E" : "#2A7E4F",
          fillLabel: t.enrolled + " of " + t.seats + " seats taken",
          waitlist: by("waitlist").map(decorate), noWaitlist: by("waitlist").length === 0,
          directory: st.directory.map(d => d.value),
          addValue: st.addValue, onAddValue: e => this.setState({addValue: e.target.value}),
          onAdd: () => {
            const v = st.addValue.trim();
            if (!v) return this.flash("Who should be added?", "Type a name from the list, or an email address.");
            const full = t.enrolled >= t.seats;
            if (full && !window.confirm(t.code + " is full (" + t.enrolled + " of " + t.seats + " seats). Add and enroll anyway?")) return;
            this.act(() => actions.addParticipant(t.id, v), "Added", v.replace(/ <.*>$/, "") + " is enrolled in " + t.code + ".", {addValue: ""});
          },
          rosterTabs: [tabBtn("registered", "Registered (" + registered.length + ")"), tabBtn("participants", "Participants (" + attendedN + ")")],
          roster, hasRoster: roster.length > 0, noRoster: roster.length === 0,
          rosterEmpty: onParticipants
            ? (showAttendance ? "No one has been marked as attended yet. Mark attendance on the Registered tab." : "Attendance can be marked once the session starts.")
            : "No one has registered for this session yet.",
          rosterNote: !onParticipants && enrolledReqs.length < t.enrolled ? (t.enrolled - enrolledReqs.length) + " further seats are counted as taken without a registration in the portal" : "",
          hasRosterNote: !onParticipants && enrolledReqs.length < t.enrolled,
          showAttendance,
          completionLabel: attendedN + " of " + enrolledReqs.length + " marked attended",
          onBack: () => this.setState({screen:"trainings", sessionId: null}),
          onEdit: () => this.setState({editorError: false, editor: Object.assign({}, t, {registration: t.registrationOpen ? "Open" : "Closed", heading:"Edit Training", cta:"Save Changes"})}),
          onExport: () => this.downloadFile("/api/export/training?id=" + encodeURIComponent(t.id), "Participant list for " + t.code + " downloaded.")
        };
      }
    }

    return {
      session,
      user: {name: meP.name, first: meP.first, initials: initialsOf(meP.name),
        sub: [meP.title, meP.nesrId && meP.nesrId !== "—" ? "NESR ID " + meP.nesrId : ""].filter(Boolean).join(" · ")},
      onSignOut: () => actions.logout(),
      year: YEAR, nav, s,
      rows, adminRows, viewTabs, typeTabs, filters, q: st.q,
      onSearch: e => this.setState({q: e.target.value}),
      clearFilters: () => this.setState({q:"", fType:"All", fCat:"All", fLoc:"All"}),
      isTable: st.calView === "table", isMonth: st.calView === "month", isCards: st.calView === "cards",
      noResults: rows.length === 0,
      resultLabel: rows.length + " of " + st.trainings.length + " sessions in the calendar",
      catalogLabel: st.trainings.length + " sessions published",
      pendingLabel: onMe + " request" + (onMe === 1 ? "" : "s") + " waiting on you · your approval is final: the person is enrolled, or waitlisted if the class is full or registration has closed",
      dayNames: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],
      monthCells, monthLabel: MONTHS[st.month] + " " + st.calYear,
      prevMonth: () => this.setState(st.month === 0 ? {month: 11, calYear: st.calYear - 1} : {month: st.month - 1}),
      nextMonth: () => this.setState(st.month === 11 ? {month: 0, calYear: st.calYear + 1} : {month: st.month + 1}),
      empty: {
        myRequests: myRequests.length === 0, teamRequests: teamRequests.length === 0, teamStats: teamStats.length === 0,
        queueRows: queueRows.length === 0, attendance: attendanceSessions.length === 0
      },
      myRequests, teamRequests, queueRows, teamStats,
      empKpis, dashList, adminKpis, fillRows, catRows, attendanceSessions, templates, ageingRows, timelineRows,
      resources: RESOURCES,
      detail, formFields, justification: st.justification,
      justificationBorder: st.formError && !String(st.justification || "").trim() ? "#8A2B2B" : "#D9DDDB",
      onJustification: e => this.setState({justification: e.target.value}),
      submitRequest: () => this.submitRequest(),
      mail, plate,
      editor: st.editor && Object.assign({}, st.editor, {cta: st.busyOp === "action" ? "Saving…" : st.editor.cta}), editorFields, saveTraining: () => this.saveTraining(),
      onNewTraining: () => this.setState({editorError: false, editor: {heading:"Add Training", cta:"Publish Session", code:"", title:"", category:"", type:"", start:"", end:"", location:"", seats:"", instructor:"", desc:"", registration:"Open"}}),
      onExport: () => this.flash("Export coming soon", "The registration report export is not wired up yet."),
      closeModal: () => this.setState({detailId: null, editor: null, editorError: false}),
      stop: e => e.stopPropagation(),
      toast: st.toast
    };
  }

  render() { return <PortalView v={this.renderVals()} />; }
}
