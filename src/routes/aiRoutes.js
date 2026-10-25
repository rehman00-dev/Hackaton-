const express = require('express');
const router = express.Router();
const { authenticateToken, requireUserScope } = require('../middleware/auth');
const { collection, currentTimestamp, objectId } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { localDate } = require('../utils/dateUtils');

const AI_LOG_RETENTION_DAYS = 30;

async function pruneAiLogs() {
  const cutoff = new Date(Date.now() - AI_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');
  await collection('aiLogs').deleteMany({ created_at: { $lt: cutoff } });
}

router.use(authenticateToken, requireUserScope);

function providerFailure(status, details = '') {
  const messages = {
    401: 'Groq rejected the API key. Create a valid Groq key, set GROQ_API_KEY in .env, then restart the server.',
    403: 'Groq denied access. Check that the API key is active and has access to this model.',
    404: 'The configured AI model was not found. Check AI_MODEL in .env against the provider’s available models.',
    429: 'The AI provider rate or usage limit was reached. Check your provider quota and try again later.'
  };
  if ([400, 401, 403].includes(status) && /api key|credential|authentication/i.test(details)) {
    const error = new Error(`AI provider rejected authentication with HTTP ${status}`);
    error.statusCode = 502;
    error.publicMessage = 'Groq did not accept this API key. Create a Groq API key at https://console.groq.com/keys, set GROQ_API_KEY in the project .env, and restart the backend.';
    return error;
  }
  if (status === 404) {
    const error = new Error(`Groq model or endpoint was not found: ${details.slice(0, 300)}`);
    error.statusCode = 502;
    error.publicMessage = 'The Groq model or API endpoint was not found. Check AI_MODEL and restart the backend.';
    return error;
  }
  const error = new Error(`Groq returned HTTP ${status}: ${details.slice(0, 500)}`);
  error.statusCode = status === 429 ? 503 : status >= 500 ? 503 : 502;
  error.publicMessage = messages[status] || (status >= 500
    ? 'Groq is temporarily unavailable. Please try again later.'
    : 'Groq rejected the request. Check the server Groq API key and model configuration.');
  return error;
}

async function requestCompletion(endpoint, key, payload, signal) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    const failure = new Error('Could not connect to the AI provider');
    failure.statusCode = 503;
    failure.publicMessage = 'Could not connect to the AI provider. Check your internet connection and AI_BASE_URL, then try again.';
    throw failure;
  }
  if (!response.ok) {
    const body = await response.text();
    let details = body;
    try {
      const payload = JSON.parse(body);
      details = `${payload.error?.message || payload.error || ''} ${payload.message || ''} ${payload.code || ''}`;
    } catch {
      details = body.slice(0, 500);
    }
    throw providerFailure(response.status, details);
  }
  try {
    return await response.json();
  } catch {
    const failure = new Error('AI provider returned an invalid response');
    failure.statusCode = 502;
    failure.publicMessage = 'The AI provider returned an unreadable response. Please try again later.';
    throw failure;
  }
}

const tools = [
  {
    type: 'function',
    function: {
      name: 'get_headcount',
      description: 'Get the current number of active employees. Admin and HR only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_attendance_summary',
      description: 'Get attendance status totals for today. Admin and HR only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_leave_summary',
      description: 'Get pending and approved leave totals. Admin and HR only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_people_on_leave_today',
      description: 'List employee names and leave types for people whose approved leave includes today. Admin and HR only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_leave_balance',
      description: 'Get the signed-in employee own leave balances.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_my_attendance',
      description: 'Get the signed-in employee own attendance for this month.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_payroll_summary',
      description: 'Get finalized payroll totals. Admin and HR only.',
      parameters: { type: 'object', properties: {}, additionalProperties: false }
    }
  }
];

function scopedTools(role) {
  return role === 'employee'
    ? tools.filter((tool) => ['get_my_leave_balance', 'get_my_attendance'].includes(tool.function.name))
    : tools.filter((tool) => tool.function.name !== 'get_my_leave_balance' && tool.function.name !== 'get_my_attendance');
}

async function executeTool(name, user) {
  const today = localDate();
  if (name === 'get_headcount' && user.role !== 'employee') {
    return { active_employees: await collection('users').countDocuments({ role: 'employee', is_active: 1 }) };
  }
  if (name === 'get_attendance_summary' && user.role !== 'employee') {
    const rows = await collection('attendance').aggregate([
      { $match: { date: today } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } }
    ]).toArray();
    return rows;
  }
  if (name === 'get_leave_summary' && user.role !== 'employee') {
    return collection('leaveRequests').aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } }
    ]).toArray();
  }
  if (name === 'get_people_on_leave_today' && user.role !== 'employee') {
    const rows = await collection('leaveRequests').find({
      status: 'approved',
      start_date: { $lte: today },
      end_date: { $gte: today }
    }).toArray();
    const users = rows.length
      ? await collection('users').find({ _id: { $in: rows.map((row) => objectId(row.user_id)) } }).toArray()
      : [];
    const names = new Map(users.map((row) => [String(row._id), row.name]));
    return rows.map((row) => ({ name: names.get(row.user_id) || '', leave_type: row.leave_type })).sort((a, b) => a.name.localeCompare(b.name));
  }
  if (name === 'get_my_leave_balance' && user.role === 'employee') {
    const types = await collection('leaveTypes').find().toArray();
    const year = Number(localDate().slice(0, 4));
    const company = await collection('companies').findOne({}, { sort: { _id: 1 }, projection: { weekend: 1 } });
    const weekendDays = String(company?.weekend || 'SAT-SUN').split('-').map((day) =>
      ({ SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 }[day])).filter(Number.isInteger);
    const holidays = new Set((await collection('holidays').find({ date: { $regex: `^${year}-` } }).toArray()).map((row) => row.date));
    return Promise.all(types.map(async (type) => {
      const requests = await collection('leaveRequests').find({
        user_id: user.id,
        leave_type: type.name,
        status: { $in: ['pending', 'approved'] },
        start_date: { $regex: `^${year}-` }
      }, { projection: { start_date: 1, end_date: 1 } }).toArray();
      const usedDays = requests.reduce((total, request) => {
        const date = new Date(`${request.start_date}T12:00:00`);
        const end = new Date(`${request.end_date}T12:00:00`);
        while (date <= end) {
          const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
          if (!weekendDays.includes(date.getDay()) && !holidays.has(key)) total += 1;
          date.setDate(date.getDate() + 1);
        }
        return total;
      }, 0);
      return { type: type.name, quota_days: type.annual_quota, used_days: usedDays, remaining_days: type.annual_quota === null ? null : Math.max(0, type.annual_quota - usedDays) };
    }));
  }
  if (name === 'get_my_attendance' && user.role === 'employee') {
    return collection('attendance').find(
      { user_id: user.id, date: { $regex: `^${today.slice(0, 7)}-` } },
      { projection: { date: 1, status: 1, check_in: 1, check_out: 1 } }
    ).sort({ date: -1 }).toArray();
  }
  if (name === 'get_payroll_summary' && user.role !== 'employee') {
    return collection('payrollRuns').aggregate([
      { $match: { status: 'finalized' } },
      { $group: {
        _id: '$month',
        employees: { $sum: 1 },
        gross: { $sum: '$gross_salary' },
        net: { $sum: '$net_salary' }
      } },
      { $project: { _id: 0, month: '$_id', employees: 1, gross: { $round: ['$gross', 2] }, net: { $round: ['$net', 2] } } },
      { $sort: { month: -1 } },
      { $limit: 6 }
    ]).toArray();
  }
  throw new Error('This tool is not available to your role');
}

router.post('/chat', asyncHandler(async (req, res) => {
  const message = String(req.body.message || '').trim();
  if (!message || message.length > 2000) return res.status(400).json({ message: 'Enter a message (maximum 2,000 characters)' });
  await pruneAiLogs();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const recentCalls = await collection('aiLogs').countDocuments({ user_id: req.user.id, created_at: { $gte: cutoff } });
  if (recentCalls >= 20) return res.status(429).json({ message: 'AI request limit reached. Please try again later.' });
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    await collection('aiLogs').insertOne({ user_id: req.user.id, prompt: message, response: 'ERROR: GROQ_API_KEY is not configured', created_at: currentTimestamp() });
    return res.status(503).json({ message: 'AI is not configured yet. Add GROQ_API_KEY in the server .env file.' });
  }

  const endpoint = `${(process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '')}/chat/completions`;
  const model = process.env.AI_MODEL || 'openai/gpt-oss-20b';
  const allowedTools = scopedTools(req.user.role);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let answer = '';
  try {
    const messages = [
      { role: 'system', content: `You are HCM Lite's assistant. Answer only using the tools' results and these policies: office default starts 09:00 with 15 minute grace; late means after grace; half day is under 5 work hours; working days skip weekends and configured holidays; standard annual quota 14, sick 8, casual 10, unpaid unlimited; payroll gross is 1.5 times basic with annualized illustrative tax slabs. Never infer or reveal another employee's salary or personal data. The signed-in role is ${req.user.role}. If data is unavailable, say so. Keep the answer concise.` },
      { role: 'user', content: message }
    ];
    let completion = await requestCompletion(endpoint, key, {
      model, messages, tools: allowedTools, tool_choice: 'auto', temperature: 0.2
    }, controller.signal);
    let toolCalls = completion.choices?.[0]?.message?.tool_calls || [];
    for (let iteration = 0; toolCalls.length && iteration < 3; iteration += 1) {
      const assistant = completion.choices[0].message;
      messages.push(assistant);
      for (const call of toolCalls) {
        const toolName = call.function?.name;
        if (!allowedTools.some((tool) => tool.function.name === toolName)) throw new Error('AI requested an unavailable data tool');
        const toolResult = await executeTool(toolName, req.user);
        messages.push({ role: 'tool', tool_call_id: call.id, name: toolName, content: JSON.stringify(toolResult) });
      }
      completion = await requestCompletion(endpoint, key, {
        model, messages, tools: allowedTools, tool_choice: 'auto', temperature: 0.2
      }, controller.signal);
      toolCalls = completion.choices?.[0]?.message?.tool_calls || [];
    }
    answer = completion.choices?.[0]?.message?.content;
    if (!answer) throw new Error('AI provider returned an empty answer');
    await collection('aiLogs').insertOne({ user_id: req.user.id, prompt: message, response: answer, created_at: currentTimestamp() });
    res.json({ response: answer, generated: true });
  } catch (error) {
    await collection('aiLogs').insertOne({ user_id: req.user.id, prompt: message, response: `ERROR: ${error.message}`, created_at: currentTimestamp() });
    if (error.name === 'AbortError') return res.status(504).json({ message: 'AI took too long to respond. Please try again.' });
    if (error.publicMessage) return res.status(error.statusCode).json({ message: error.publicMessage });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}));

router.post('/smart-leave', asyncHandler(async (req, res) => {
  if (req.user.role !== 'employee') return res.status(403).json({ message: 'Smart leave is available to employees only' });
  const prompt = String(req.body.prompt || '').trim();
  if (!prompt || prompt.length > 500) return res.status(400).json({ message: 'Describe your leave in 1–500 characters' });
  await pruneAiLogs();
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const recentCalls = await collection('aiLogs').countDocuments({ user_id: req.user.id, created_at: { $gte: cutoff } });
  if (recentCalls >= 20) return res.status(429).json({ message: 'AI request limit reached. Please try again later.' });
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    await collection('aiLogs').insertOne({ user_id: req.user.id, prompt, response: 'ERROR: GROQ_API_KEY is not configured', created_at: currentTimestamp() });
    return res.status(503).json({ message: 'AI is not configured yet. Add GROQ_API_KEY in the server .env file.' });
  }
  const leaveTypes = await collection('leaveTypes').find({}, { projection: { name: 1 } }).sort({ _id: 1 }).toArray();
  const allowedTypes = leaveTypes.map((item) => item.name);
  const endpoint = `${(process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '')}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const result = await requestCompletion(endpoint, key, {
        model: process.env.AI_MODEL || 'openai/gpt-oss-20b',
        temperature: 0,
        messages: [
          { role: 'system', content: `Create a draft leave form only. Today's date is ${localDate()}. Choose one leave type from ${JSON.stringify(allowedTypes)}. Resolve relative dates from today. Do not save or submit anything. If the request is not clearly a leave request or dates cannot be resolved, use empty dates and explain the issue in reason.` },
          { role: 'user', content: prompt }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'create_leave_draft',
            description: 'Return a leave form draft; never submit it.',
            parameters: {
              type: 'object',
              properties: {
                leaveType: { type: 'string', enum: allowedTypes },
                startDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
                endDate: { type: 'string', description: 'ISO date YYYY-MM-DD' },
                reason: { type: 'string' }
              },
              required: ['leaveType', 'startDate', 'endDate', 'reason'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'create_leave_draft' } }
      }, controller.signal);
    const raw = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const draft = JSON.parse(raw || '{}');
    const validDate = (value) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    };
    if (!allowedTypes.some((type) => type.toLowerCase() === String(draft.leaveType).toLowerCase()) ||
        !validDate(draft.startDate) || !validDate(draft.endDate) || draft.startDate > draft.endDate ||
        typeof draft.reason !== 'string') {
      throw new Error('AI returned an invalid leave draft');
    }
    const output = {
      leaveType: allowedTypes.find((type) => type.toLowerCase() === draft.leaveType.toLowerCase()),
      startDate: draft.startDate,
      endDate: draft.endDate,
      reason: draft.reason.slice(0, 500)
    };
    await collection('aiLogs').insertOne({ user_id: req.user.id, prompt, response: JSON.stringify(output), created_at: currentTimestamp() });
    res.json({ draft: output, generated: true, message: 'Review this draft and submit it when ready.' });
  } catch (error) {
    await collection('aiLogs').insertOne({ user_id: req.user.id, prompt, response: `ERROR: ${error.message}`, created_at: currentTimestamp() });
    if (error.name === 'AbortError') return res.status(504).json({ message: 'AI took too long to respond. Please fill in the leave form manually.' });
    if (error.message === 'AI returned an invalid leave draft') return res.status(502).json({ message: 'AI could not understand those dates. Please fill in the form manually.' });
    if (error.publicMessage) return res.status(error.statusCode).json({ message: error.publicMessage });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}));

module.exports = router;
