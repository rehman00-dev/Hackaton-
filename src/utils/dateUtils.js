const timeZone = process.env.APP_TIME_ZONE || 'Asia/Karachi';
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

function dateParts(date = new Date()) {
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function localDate(date = new Date()) {
  const parts = dateParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function localTimeMinutes(date = new Date()) {
  const parts = dateParts(date);
  return Number(parts.hour) * 60 + Number(parts.minute);
}

module.exports = { localDate, localTimeMinutes };
