import React, { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, LogIn, LogOut, MapPin, ScanFace } from 'lucide-react';
import { api, getCheckInLocation, localDateString, request } from '../lib/api.js';
import { formatTime } from '../lib/format.js';
import { Avatar, Card, DataTable, Notice, ReviewButtons, Status } from '../components/ui.jsx';

export default function Attendance({ data, user, submit, busy }) {
  const [date, setDate] = useState(localDateString());
  const [boardRecords, setBoardRecords] = useState([]);
  const [correctionRows, setCorrectionRows] = useState([]);
  const [boardError, setBoardError] = useState('');
  const [correction, setCorrection] = useState({ date: localDateString(), checkIn: '', checkOut: '', reason: '' });

  useEffect(() => {
    if (user.role === 'employee') return;
    let active = true;
    Promise.all([api(`/hr/attendance?date=${date}`), api('/hr/corrections')])
      .then(([records, corrections]) => {
        if (active) {
          setBoardRecords(records);
          setCorrectionRows(corrections);
          setBoardError('');
        }
      })
      .catch((error) => { if (active) setBoardError(error.message); });
    return () => { active = false; };
  }, [date, data, user.role]);

  if (user.role === 'employee') {
    return (
      <div className="page-stack">
        <div className="content-grid">
          <ClockActions data={data} submit={submit} busy={busy} />
          <CameraAttendance submit={submit} busy={busy} />
        </div>
        <Card title="My attendance history">
          <DataTable columns={['Date', 'Check in', 'Check out', 'Status', 'Late']} rows={data || []} keys={['date', 'check_in', 'check_out', 'status', 'late_minutes']} empty="Your attendance history will appear here."
            renderRow={(row) => <tr key={row.id}><td>{row.date}</td><td className="num">{row.check_in ? formatTime(row.check_in) : '—'}</td><td className="num">{row.check_out ? formatTime(row.check_out) : '—'}</td><td><Status value={row.status} /></td><td>{row.late_minutes ? `${row.late_minutes} min` : '—'}</td></tr>} />
        </Card>
        <Card title="Request an attendance correction" subtitle="Forgot to check in or out? Send it to HR for review.">
          <form className="form-grid" onSubmit={(event) => {
            event.preventDefault();
            const toIsoString = (value) => value ? new Date(value).toISOString() : '';
            submit((body) => api('/employee/attendance-correction', request('POST', body)), {
              ...correction,
              checkIn: toIsoString(correction.checkIn),
              checkOut: toIsoString(correction.checkOut)
            }, 'Correction request submitted');
          }}>
            <label>Date<input type="date" max={localDateString()} required value={correction.date} onChange={(e) => setCorrection({ ...correction, date: e.target.value })} /></label>
            <label>Requested check-in<input type="datetime-local" required={!correction.checkOut} value={correction.checkIn} onChange={(e) => setCorrection({ ...correction, checkIn: e.target.value })} /></label>
            <label>Requested check-out<input type="datetime-local" required={!correction.checkIn} value={correction.checkOut} onChange={(e) => setCorrection({ ...correction, checkOut: e.target.value })} /></label>
            <label className="span-two">Reason<textarea required minLength={5} value={correction.reason} onChange={(e) => setCorrection({ ...correction, reason: e.target.value })} /></label>
            <div className="form-actions"><button className="button button-primary" disabled={busy}>Send for review</button></div>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-stack">
      {boardError && <Notice type="error">{boardError}</Notice>}
      <Card title="Daily attendance board" actions={<input className="select-input" aria-label="Attendance date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />} subtitle="Review attendance and corrections submitted by employees.">
        <DataTable columns={['Employee', 'Code', 'Department', 'Check-in', 'Check-out', 'Status']} rows={boardRecords} keys={['name', 'employee_code', 'department_name']} empty="No attendance entries for this date."
          renderRow={(row) => <tr key={row.id}><td><div className="person-cell"><Avatar name={row.name} /><strong>{row.name}</strong></div></td><td><code className="chip-code">{row.employee_code || '—'}</code></td><td>{row.department_name || '—'}</td><td className="num">{row.check_in ? formatTime(row.check_in) : '—'}</td><td className="num">{row.check_out ? formatTime(row.check_out) : '—'}</td><td><Status value={row.status} /></td></tr>} />
      </Card>
      <Card title="Attendance correction inbox">
        <DataTable columns={['Employee', 'Date', 'Requested in', 'Requested out', 'Reason', 'Status', 'Review']} rows={correctionRows} keys={['name', 'date', 'reason']} empty="No correction requests."
          renderRow={(row) => <tr key={row.id}><td>{row.name}</td><td>{row.date}</td><td className="num">{row.requested_check_in ? formatTime(row.requested_check_in) : '—'}</td><td className="num">{row.requested_check_out ? formatTime(row.requested_check_out) : '—'}</td><td>{row.reason}</td><td><Status value={row.status} /></td><td>{row.status === 'pending' ? <ReviewButtons onReview={(decision) => submit((body) => api(`/hr/corrections/${row.id}/review`, request('POST', body)), { decision, comment: '' })} /> : '—'}</td></tr>} />
      </Card>
    </div>
  );
}

function ClockActions({ data, submit, busy }) {
  const record = data?.find((item) => item.date === localDateString());
  const [locationWarning, setLocationWarning] = useState('');
  const [locating, setLocating] = useState(false);
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000 * 15);
    return () => window.clearInterval(timer);
  }, []);
  async function checkIn() {
    setLocationWarning('');
    setLocating(true);
    const { coordinates, warning } = await getCheckInLocation();
    setLocationWarning(warning);
    setLocating(false);
    await submit((body) => api('/employee/checkin', request('POST', body)), coordinates);
  }
  return (
    <Card title="Today’s check-in" subtitle={record ? `Checked in at ${record.check_in ? formatTime(record.check_in) : '—'}` : 'Your attendance is stamped by the server.'} className="clock-card">
      <div className="clock-face" aria-hidden="true">
        <strong>{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
        <small>{now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</small>
      </div>
      {locationWarning && <p className="location-warning" role="status"><MapPin size={14} aria-hidden="true" />{locationWarning}</p>}
      <div className="clock-actions">
        {record?.check_out
          ? <><Status value={record.status} /><span className="muted">Checked out at {formatTime(record.check_out)}</span></>
          : record
            ? <><Status value={record.status} /><button className="button button-primary" disabled={busy} onClick={() => submit(() => api('/employee/checkout', { method: 'POST' }), null)}><LogOut size={15} aria-hidden="true" />Check out</button></>
            : <button className="button button-primary" disabled={busy || locating} onClick={checkIn}><LogIn size={15} aria-hidden="true" />{locating ? 'Checking location…' : busy ? 'Checking in…' : 'Check in'}</button>}
      </div>
    </Card>
  );
}

function CameraAttendance({ submit, busy }) {
  const videoRef = useRef(null);
  const detectorRef = useRef(null);
  const streamRef = useRef(null);
  const [camera, setCamera] = useState(false);
  const [faceFound, setFaceFound] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [locationWarning, setLocationWarning] = useState('');
  const [starting, setStarting] = useState(false);
  const [locating, setLocating] = useState(false);
  const intervalRef = useRef(null);
  useEffect(() => () => {
    window.clearInterval(intervalRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    detectorRef.current?.close();
  }, []);
  async function startCamera() {
    setStarting(true);
    setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access requires HTTPS or localhost and a supported browser.');
      const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm');
      detectorRef.current = await FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite' },
        runningMode: 'VIDEO'
      });
      setCamera(true);
      const inspect = () => {
        if (!videoRef.current || !detectorRef.current || videoRef.current.readyState < 2) return;
        try {
          setFaceFound(detectorRef.current.detectForVideo(videoRef.current, performance.now()).detections.length > 0);
        } catch (error) {
          console.error('Face detection failed', error);
        }
      };
      videoRef.current.onloadeddata = inspect;
      intervalRef.current = window.setInterval(inspect, 500);
      stream.getTracks()[0].addEventListener('ended', () => window.clearInterval(intervalRef.current), { once: true });
    } catch (error) {
      window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCameraError(error.message || 'Camera could not be started.');
    } finally {
      setStarting(false);
    }
  }
  async function checkIn() {
    setLocationWarning('');
    setLocating(true);
    const { coordinates, warning } = await getCheckInLocation();
    setLocationWarning(warning);
    setLocating(false);
    const result = await submit((body) => api('/employee/checkin', request('POST', body)), coordinates);
    if (result) {
      window.clearInterval(intervalRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      setCamera(false);
    }
  }
  return (
    <Card title="Camera check-in" subtitle="Optional face-presence check. Your camera image and face data are not uploaded or stored.">
      <div className="camera-layout">
        <div className={`camera-frame ${faceFound ? 'detected' : ''}`}>
          <video ref={videoRef} className={camera ? 'camera-video' : 'video-hidden'} muted playsInline />
          {!camera && <div className="camera-placeholder"><ScanFace size={34} strokeWidth={1.4} aria-hidden="true" /><small>Camera preview appears here</small></div>}
          {camera && <span className="scan-corners" aria-hidden="true" />}
          <div className={`face-status ${faceFound ? 'detected' : ''}`}>{camera ? faceFound ? 'Face detected' : 'Looking for a face…' : 'Camera is off'}</div>
        </div>
        <div className="camera-info">
          <p>Face detection runs on this device only; it confirms a face is visible but does not identify who you are. Location is checked against your Admin’s office radius when configured.</p>
          {cameraError && <Notice type="error">{cameraError}</Notice>}
          {locationWarning && <p className="location-warning" role="status"><MapPin size={14} aria-hidden="true" />{locationWarning}</p>}
          <div className="camera-actions">
            {!camera
              ? <button className="button button-secondary" onClick={startCamera} disabled={starting}><Camera size={15} aria-hidden="true" />{starting ? 'Starting camera…' : 'Enable camera'}</button>
              : <button className="button button-primary" disabled={!faceFound || busy || locating} onClick={checkIn}>{locating ? 'Checking location…' : busy ? 'Checking in…' : faceFound ? 'Confirm check-in' : 'Waiting for face'}</button>}
            {camera && <button className="button button-quiet" onClick={() => { window.clearInterval(intervalRef.current); streamRef.current?.getTracks().forEach((track) => track.stop()); setCamera(false); setFaceFound(false); }}><CameraOff size={15} aria-hidden="true" />Turn camera off</button>}
          </div>
        </div>
      </div>
    </Card>
  );
}
