import React from 'react';
import { ArrowRight, Banknote, CalendarClock, CalendarDays, Clock3, FileText, MessageCircle, UserCheck, UsersRound } from 'lucide-react';
import { Card, EmptyState, Stat } from '../components/ui.jsx';
import SceneSlot from '../components/SceneSlot.jsx';
import { DepartmentChart, StatusDonut } from '../components/Charts.jsx';
import { formatTime, money } from '../lib/format.js';
import { AnnouncementList } from '../components/AnnouncementList.jsx';

function Hero({ eyebrow, title, text, children }) {
  return (
    <section className="hero-panel" data-reveal>
      <div className="hero-copy">
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{text}</p>
        <div className="hero-actions">{children}</div>
      </div>
      <SceneSlot compact className="hero-scene" />
    </section>
  );
}

export default function Overview({ data, user, go }) {
  if (!data) return <EmptyState title="Loading your overview" />;
  if (user.role === 'employee') {
    return (
      <div className="page-stack">
        <Hero eyebrow="YOUR WORKDAY" title={`Good to see you, ${user.name.split(' ')[0]}.`} text="Keep track of your hours, leave and latest payslip here.">
          <button className="button button-primary" onClick={() => go('attendance')}>Open attendance <ArrowRight size={15} aria-hidden="true" /></button>
        </Hero>
        <div className="stats-grid cols-3">
          <Stat title="Today's status" icon={Clock3} tone="violet" value={data.attendance?.status || 'Not checked in'} hint={data.attendance?.check_in ? `In at ${formatTime(data.attendance.check_in)}` : 'Attendance'} />
          <Stat title="Approved leave" icon={CalendarDays} tone="cyan" value={data.approvedLeaveCount ?? 0} hint="Requests" />
          <Stat title="Last payslip" icon={FileText} tone="emerald" value={data.lastPayslip ? money(data.lastPayslip.net_salary) : '—'} hint={data.lastPayslip?.month || 'Not available yet'} />
        </div>
        <Card title="Company announcements"><AnnouncementList rows={data.announcements} /></Card>
      </div>
    );
  }
  const totals = Object.fromEntries((data.attendanceToday || []).map((row) => [row.status, row.count]));
  const leaves = Object.fromEntries((data.leaveRequests || []).map((row) => [row.status, row.count]));
  const isAdmin = user.role === 'admin';
  const present = isAdmin ? (totals.present || 0) : (totals.present || 0) + (totals.late || 0);
  const headcount = data.headcount ?? 0;
  const pending = leaves.pending || 0;
  const statItems = [
    { title: 'Headcount', value: headcount, hint: 'Active employees', icon: UsersRound, tone: 'violet' },
    { title: 'Present today', value: present, hint: 'Checked in', icon: UserCheck, tone: 'emerald', progress: headcount ? present / headcount : undefined },
    { title: 'Pending leave', value: pending, hint: 'Needs review', icon: CalendarClock, tone: 'amber' },
    { title: isAdmin ? 'Payroll cost' : 'Finalized payroll', value: money(data.finalizedPayroll || 0), hint: isAdmin ? 'Finalized payroll' : 'Net total', icon: Banknote, tone: 'cyan' }
  ];
  const departmentCountKey = isAdmin ? 'count' : 'employees';
  return (
    <div className="page-stack">
      <Hero eyebrow={isAdmin ? 'COMPANY OVERVIEW' : 'PEOPLE OPERATIONS'} title="Here’s what’s happening today." text="Your dashboard reflects activity recorded in this workspace.">
        {pending > 0 && <button className="button button-primary" onClick={() => go('leave')}>Review {pending} pending leave <ArrowRight size={15} aria-hidden="true" /></button>}
        <button className="button button-secondary" onClick={() => go('assistant')}><MessageCircle size={15} aria-hidden="true" />Ask assistant</button>
      </Hero>
      <div className="stats-grid">{statItems.map((item) => <Stat key={item.title} {...item} />)}</div>
      <div className="content-grid">
        <Card title="Attendance today"><StatusDonut data={data.attendanceToday || []} nameKey="status" valueKey="count" empty="No attendance recorded today." /></Card>
        <Card title="Leave requests"><StatusDonut data={data.leaveRequests || []} nameKey="status" valueKey="count" empty="No leave requests yet." /></Card>
      </div>
      <Card title="Employees by department"><DepartmentChart data={data.departments || []} valueKey={departmentCountKey} empty="Create departments and register employees to see this breakdown." /></Card>
    </div>
  );
}
