import React from 'react';
import { useReducedMotion } from 'motion/react';
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { EmptyState } from './ui.jsx';

const fallbackColors = ['#8B5CF6', '#22D3EE', '#34D399', '#FBBF24', '#FB7185'];
// Semantic colours so "present" is always green and "rejected" always red, regardless of order.
const semantic = {
  present: '#34D399', approved: '#34D399', finalized: '#34D399', active: '#34D399',
  late: '#FBBF24', pending: '#FBBF24', draft: '#FBBF24', half_day: '#FBBF24',
  absent: '#FB7185', rejected: '#FB7185', cancelled: '#94A3B8', on_leave: '#22D3EE'
};
const colorFor = (name, index) => semantic[String(name).toLowerCase()] || fallbackColors[index % fallbackColors.length];

const tooltipStyle = {
  border: '1px solid var(--line-strong)', borderRadius: 12, background: 'var(--surface-raised)',
  color: 'var(--text)', boxShadow: 'var(--shadow-pop)', fontSize: 12, padding: '8px 12px'
};

export function StatusDonut({ data, nameKey, valueKey, empty }) {
  const reduceMotion = useReducedMotion();
  if (!data.length) return <EmptyState title={empty} />;
  const total = data.reduce((sum, row) => sum + (Number(row[valueKey]) || 0), 0);
  return (
    <div className="chart-layout">
      <div className="chart-visual" role="img" aria-label={data.map((row) => `${row[nameKey]}: ${row[valueKey]}`).join(', ')}>
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius={62} outerRadius={86} paddingAngle={4} cornerRadius={6} stroke="none" isAnimationActive={!reduceMotion} animationDuration={900}>
              {data.map((row, index) => <Cell key={row[nameKey]} fill={colorFor(row[nameKey], index)} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text)' }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="chart-center"><strong>{total.toLocaleString()}</strong><small>total</small></div>
      </div>
      <ul className="chart-legend" aria-label="Chart values">
        {data.map((row, index) => (
          <li key={row[nameKey]}>
            <span className="chart-legend-label"><i style={{ background: colorFor(row[nameKey], index) }} />{String(row[nameKey]).replaceAll('_', ' ')}</span>
            <strong>{row[valueKey]}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DepartmentChart({ data, valueKey, empty }) {
  const reduceMotion = useReducedMotion();
  if (!data.length) return <EmptyState title={empty} />;
  return (
    <div className="department-chart" role="img" aria-label={`Employees by department: ${data.map((row) => `${row.name}: ${row[valueKey]}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height={Math.max(190, data.length * 44)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 8 }} barCategoryGap={12}>
          <defs>
            <linearGradient id="deptBar" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#7C3AED" />
              <stop offset="100%" stopColor="#22D3EE" />
            </linearGradient>
          </defs>
          <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={118} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: 'rgba(139, 92, 246, .08)' }} contentStyle={tooltipStyle} itemStyle={{ color: 'var(--text)' }} />
          <Bar dataKey={valueKey} name="Employees" fill="url(#deptBar)" radius={[0, 8, 8, 0]} isAnimationActive={!reduceMotion} animationDuration={900} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
