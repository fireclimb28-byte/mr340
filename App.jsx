import { useState, useEffect, useCallback } from 'react';
import { locations, RACE_START_DATE, RACE_START_TIME } from './locations.js';
import './App.css';

const STORAGE_KEY = 'mr340_times_2026';

// Parse "YYYY-MM-DDTHH:mm" → Date object (local time)
function parseLocal(str) {
  if (!str) return null;
  const [date, time] = str.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

// Date → "YYYY-MM-DDTHH:mm"
function toLocalInput(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Hours between two dates
function hoursBetween(a, b) {
  return (b - a) / 3600000;
}

// Format a date as "Mon Jul 28 · 2:45 PM"
function formatDateTime(date) {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + ' · '
    + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

// Format duration in hours → "4h 22m"
function formatDuration(hrs) {
  if (hrs == null || isNaN(hrs)) return '—';
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${pad2(m)}m`;
}

function pad2(n) { return String(n).padStart(2, '0'); }

const categoryColor = {
  'Check Point': '#1a6fc4',
  'Paddle Stop': '#c49a1a',
  'Unsupported Ramp': '#888',
};

const categoryBg = {
  'Check Point': '#e8f1fc',
  'Paddle Stop': '#fdf6e3',
  'Unsupported Ramp': '#f5f5f5',
};

export default function App() {
  const raceStart = parseLocal(`${RACE_START_DATE}T${RACE_START_TIME}`);

  const [times, setTimes] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return { 1: { arrival: `${RACE_START_DATE}T${RACE_START_TIME}`, departure: `${RACE_START_DATE}T${RACE_START_TIME}` } };
  });

  const [editing, setEditing] = useState(null);
  const [editValues, setEditValues] = useState({ arrival: '', departure: '' });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(times));
  }, [times]);

  // --- Compute derived data ---
  let lastDepartureMile = 0;
  let lastDepartureTime = raceStart;
  let legPaces = [];

  const derived = locations.map((loc, idx) => {
    const t = times[loc.id] || {};
    const arrival = t.arrival ? parseLocal(t.arrival) : null;
    const departure = t.departure ? parseLocal(t.departure) : null;

    let legPace = null;
    let legHours = null;

    // Use arrival if available, otherwise departure — so pace is calculated
    // regardless of whether the user entered arrival, departure, or both.
    const checkpoint = arrival || departure;
    if (checkpoint && idx > 0) {
      const prevDep = lastDepartureTime;
      const distMiles = loc.raceMile - lastDepartureMile;
      const hrs = hoursBetween(prevDep, checkpoint);
      if (hrs > 0 && distMiles > 0) {
        legPace = distMiles / hrs;
        legHours = hrs;
        legPaces.push(legPace);
      }
    }

    if (departure) {
      lastDepartureTime = departure;
      lastDepartureMile = loc.raceMile;
    } else if (arrival) {
      lastDepartureTime = arrival;
      lastDepartureMile = loc.raceMile;
    }

    return { loc, arrival, departure, legPace, legHours };
  });

  const avgPace = legPaces.length > 0
    ? legPaces.reduce((a, b) => a + b, 0) / legPaces.length
    : null;

  const weightedPace = legPaces.length > 0
    ? (() => {
        let weightSum = 0, valSum = 0;
        legPaces.forEach((p, i) => {
          const w = i + 1;
          valSum += p * w;
          weightSum += w;
        });
        return valSum / weightSum;
      })()
    : null;

  const paceMph = weightedPace || avgPace;

  const predictions = derived.map(({ loc, arrival, departure }) => {
    if (arrival || departure) return null;
    if (!paceMph) return null;
    const distFromLastDep = loc.raceMile - lastDepartureMile;
    if (distFromLastDep <= 0) return null;
    const hrs = distFromLastDep / paceMph;
    return new Date(lastDepartureTime.getTime() + hrs * 3600000);
  });

  const lastLoggedIdx = derived.reduce((acc, { arrival, departure }, i) =>
    (arrival || departure) ? i : acc, -1);

  function openEdit(loc) {
    const t = times[loc.id] || {};
    setEditValues({
      arrival: t.arrival || '',
      departure: t.departure || '',
    });
    setEditing(loc.id);
  }

  function saveEdit(locId) {
    setTimes(prev => ({
      ...prev,
      [locId]: {
        arrival: editValues.arrival,
        departure: editValues.departure,
      },
    }));
    setEditing(null);
  }

  function clearEdit(locId) {
    setTimes(prev => {
      const next = { ...prev };
      delete next[locId];
      return next;
    });
    setEditing(null);
  }

  function resetAll() {
    if (confirm('Clear all entered times and start over?')) {
      setTimes({ 1: { arrival: `${RACE_START_DATE}T${RACE_START_TIME}`, departure: `${RACE_START_DATE}T${RACE_START_TIME}` } });
      setEditing(null);
    }
  }

  const visibleDerived = showAll
    ? derived
    : derived.filter((_, i) => {
        if (i <= lastLoggedIdx) return true;
        if (i <= lastLoggedIdx + 5) return true;
        if (i === derived.length - 1) return true;
        return false;
      });

  const totalMiles = locations[locations.length - 1].raceMile;
  const milesCompleted = lastLoggedIdx >= 0 ? derived[lastLoggedIdx].loc.raceMile : 0;
  const pctDone = (milesCompleted / totalMiles) * 100;

  const elapsedHrs = lastLoggedIdx >= 0
    ? hoursBetween(raceStart, derived[lastLoggedIdx].departure || derived[lastLoggedIdx].arrival || raceStart)
    : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div>
            <h1>MR 340 · 2026</h1>
            <p className="subtitle">Missouri River Race · 340 Miles</p>
          </div>
          <button className="btn-reset" onClick={resetAll} title="Reset all times">↺ Reset</button>
        </div>

        <div className="progress-section">
          <div className="progress-bar-bg">
            <div className="progress-bar-fill" style={{ width: `${pctDone}%` }} />
          </div>
          <div className="progress-stats">
            <span>{milesCompleted.toFixed(1)} / {totalMiles} mi</span>
            {elapsedHrs > 0 && <span>Elapsed: {formatDuration(elapsedHrs)}</span>}
            {paceMph && <span>Pace: {paceMph.toFixed(1)} mph</span>}
          </div>
        </div>
      </header>

      <main className="main">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Location</th>
                <th>Mile</th>
                <th>Arrival</th>
                <th>Departure</th>
                <th>Pace</th>
              </tr>
            </thead>
            <tbody>
              {visibleDerived.map(({ loc, arrival, departure, legPace, legHours }, visIdx) => {
                const realIdx = derived.findIndex(d => d.loc.id === loc.id);
                const pred = predictions[realIdx];
                const isEditing = editing === loc.id;
                const hasData = !!(arrival || departure);
                const isCurrent = realIdx === lastLoggedIdx;
                const isStart = loc.status === 'START';
                const isFinish = loc.status === 'FINISH';

                const prevVisIdx = visIdx > 0 ? derived.findIndex(d => d.loc.id === visibleDerived[visIdx - 1].loc.id) : realIdx - 1;
                const showGap = !showAll && realIdx - prevVisIdx > 1;

                return (
                  <>
                    {showGap && (
                      <tr key={`gap-${loc.id}`} className="gap-row">
                        <td colSpan={6} onClick={() => setShowAll(true)}>
                          ··· {realIdx - prevVisIdx - 1} more locations — tap to show all
                        </td>
                      </tr>
                    )}
                    <tr
                      key={loc.id}
                      className={[
                        'loc-row',
                        hasData ? 'logged' : '',
                        isCurrent ? 'current' : '',
import { locations, RACE_START_DATE, RACE_START_TIME } from './locations.js';
import './App.css';

const STORAGE_KEY = 'mr340_times_2026';

function parseLocal(str) {
  if (!str) return null;
  const [date, time] = str.split('T');
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi);
}

function toLocalInput(date) {
  if (!date) return '';
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hoursBetween(a, b) { return (b - a) / 3600000; }

function formatDateTime(date) {
  if (!date) return '—';
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    + ' · '
    + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function pad2(n) { return String(n).padStart(2, '0'); }

function formatDuration(hrs) {
  if (hrs == null || isNaN(hrs)) return '—';
  const h = Math.floor(hrs);
  const m = Math.round((hrs - h) * 60);
  return `${h}h ${pad2(m)}m`;
}

const categoryColor = { 'Check Point': '#1a6fc4', 'Paddle Stop': '#c49a1a', 'Unsupported Ramp': '#888' };
const categoryBg = { 'Check Point': '#e8f1fc', 'Paddle Stop': '#fdf6e3', 'Unsupported Ramp': '#f5f5f5' };

export default function App() {
  const raceStart = parseLocal(`${RACE_START_DATE}T${RACE_START_TIME}`);

  const [times, setTimes] = useState(() => {
    try { const s = localStorage.getItem(STORAGE_KEY); if (s) return JSON.parse(s); } catch {}
    return { 1: { arrival: `${RACE_START_DATE}T${RACE_START_TIME}`, departure: `${RACE_START_DATE}T${RACE_START_TIME}` } };
  });

  const [editing, setEditing] = useState(null);
  const [editValues, setEditValues] = useState({ arrival: '', departure: '' });
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(times)); }, [times]);

  let lastDepartureMile = 0;
  let lastDepartureTime = raceStart;
  let legPaces = [];

  const derived = locations.map((loc, idx) => {
    const t = times[loc.id] || {};
    const arrival = t.arrival ? parseLocal(t.arrival) : null;
    const departure = t.departure ? parseLocal(t.departure) : null;

    let legPace = null;
    let legHours = null;

    // FIX: use arrival OR departure — pace calculates even if only one is entered
    const checkpoint = arrival || departure;
    if (checkpoint && idx > 0) {
      const distMiles = loc.raceMile - lastDepartureMile;
      const hrs = hoursBetween(lastDepartureTime, checkpoint);
      if (hrs > 0 && distMiles > 0) {
        legPace = distMiles / hrs;
        legHours = hrs;
        legPaces.push(legPace);
      }
    }

    if (departure) { lastDepartureTime = departure; lastDepartureMile = loc.raceMile; }
    else if (arrival) { lastDepartureTime = arrival; lastDepartureMile = loc.raceMile; }

    return { loc, arrival, departure, legPace, legHours };
  });

  const avgPace = legPaces.length > 0 ? legPaces.reduce((a,b)=>a+b,0)/legPaces.length : null;
  const weightedPace = legPaces.length > 0 ? (() => {
    let ws=0, vs=0;
    legPaces.forEach((p,i)=>{ const w=i+1; vs+=p*w; ws+=w; });
    return vs/ws;
  })() : null;
  const paceMph = weightedPace || avgPace;

  const predictions = derived.map(({ loc, arrival, departure }) => {
    if (arrival || departure) return null;
    if (!paceMph) return null;
    const dist = loc.raceMile - lastDepartureMile;
    if (dist <= 0) return null;
    return new Date(lastDepartureTime.getTime() + (dist/paceMph)*3600000);
  });

  const lastLoggedIdx = derived.reduce((acc,{arrival,departure},i) => (arrival||departure)?i:acc, -1);

  function openEdit(loc) {
    const t = times[loc.id] || {};
    setEditValues({ arrival: t.arrival||'', departure: t.departure||'' });
    setEditing(loc.id);
  }

  function saveEdit(locId) {
    setTimes(prev => ({ ...prev, [locId]: { arrival: editValues.arrival, departure: editValues.departure } }));
    setEditing(null);
  }

  function clearEdit(locId) {
    setTimes(prev => { const n={...prev}; delete n[locId]; return n; });
    setEditing(null);
  }

  function resetAll() {
    if (confirm('Clear all times and start over?')) {
      setTimes({ 1: { arrival: `${RACE_START_DATE}T${RACE_START_TIME}`, departure: `${RACE_START_DATE}T${RACE_START_TIME}` } });
      setEditing(null);
    }
  }

  const visibleDerived = showAll ? derived : derived.filter((_,i) => i<=lastLoggedIdx || i<=lastLoggedIdx+5 || i===derived.length-1);
  const totalMiles = locations[locations.length-1].raceMile;
  const milesCompleted = lastLoggedIdx>=0 ? derived[lastLoggedIdx].loc.raceMile : 0;
  const pctDone = (milesCompleted/totalMiles)*100;
  const elapsedHrs = lastLoggedIdx>=0 ? hoursBetween(raceStart, derived[lastLoggedIdx].departure||derived[lastLoggedIdx].arrival||raceStart) : 0;

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div><h1>MR 340 · 2026</h1><p className="subtitle">Missouri River Race · 340 Miles</p></div>
          <button className="btn-reset" onClick={resetAll}>↺ Reset</button>
        </div>
        <div className="progress-section">
          <div className="progress-bar-bg"><div className="progress-bar-fill" style={{width:`${pctDone}%`}}/></div>
          <div className="progress-stats">
            <span>{milesCompleted.toFixed(1)} / {totalMiles} mi</span>
            {elapsedHrs>0 && <span>Elapsed: {formatDuration(elapsedHrs)}</span>}
            {paceMph && <span>Pace: {paceMph.toFixed(1)} mph</span>}
          </div>
        </div>
      </header>
      <main className="main">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>#</th><th>Location</th><th>Mile</th><th>Arrival</th><th>Departure</th><th>Pace</th></tr></thead>
            <tbody>
              {visibleDerived.map(({loc,arrival,departure,legPace},visIdx) => {
                const realIdx = derived.findIndex(d=>d.loc.id===loc.id);
                const pred = predictions[realIdx];
                const isEditing = editing===loc.id;
                const hasData = !!(arrival||departure);
                const isCurrent = realIdx===lastLoggedIdx;
                const prevVisIdx = visIdx>0 ? derived.findIndex(d=>d.loc.id===visibleDerived[visIdx-1].loc.id) : realIdx-1;
                const showGap = !showAll && realIdx-prevVisIdx>1;
                return (
                  <>
                    {showGap && <tr key={`gap-${loc.id}`} className="gap-row"><td colSpan={6} onClick={()=>setShowAll(true)}>··· {realIdx-prevVisIdx-1} more — tap to show all</td></tr>}
                    <tr key={loc.id} className={['loc-row',hasData?'logged':'',isCurrent?'current':'',loc.status==='START'?'is-start':'',loc.status==='FINISH'?'is-finish':''].join(' ')} style={{'--cat-color':categoryColor[loc.category],'--cat-bg':categoryBg[loc.category]}}>
                      <td className="col-num"><span className="loc-num">{loc.id}</span></td>
                      <td className="col-name">
                        <span className="cat-badge" style={{background:categoryBg[loc.category],color:categoryColor[loc.category]}}>{loc.category==='Check Point'?'CP':loc.category==='Paddle Stop'?'PS':'Ramp'}</span>
                        <span className="loc-name">{loc.name}</span>
                        <span className="loc-side">{loc.side}</span>
                        {isEditing ? (
                          <div className="edit-form">
                            <label>Arrival<input type="datetime-local" value={editValues.arrival} onChange={e=>setEditValues(v=>({...v,arrival:e.target.value}))}/></label>
                            <label>Departure<input type="datetime-local" value={editValues.departure} onChange={e=>setEditValues(v=>({...v,departure:e.target.value}))}/></label>
                            <div className="edit-actions">
                              <button className="btn-save" onClick={()=>saveEdit(loc.id)}>Save</button>
                              <button className="btn-cancel" onClick={()=>setEditing(null)}>Cancel</button>
                              {hasData && <button className="btn-clear" onClick={()=>clearEdit(loc.id)}>Clear</button>}
                            </div>
                          </div>
                        ) : <button className="btn-edit" onClick={()=>openEdit(loc)}>{hasData?'Edit':'+ Log'}</button>}
                      </td>
                      <td className="col-mile">{loc.raceMile}</td>
                      <td className="col-time">
                        {arrival ? <span className="time-logged">{formatDateTime(arrival)}</span>
                          : pred ? <span className="time-pred">~{formatDateTime(pred)}</span>
                          : <span className="time-empty">—</span>}
                      </td>
                      <td className="col-time">{departure ? <span className="time-logged">{formatDateTime(departure)}</span> : <span className="time-empty">—</span>}</td>
                      <td className="col-pace">{legPace!=null ? <span className="pace-val">{legPace.toFixed(1)}<small> mph</small></span> : <span className="time-empty">—</span>}</td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
        {!showAll && derived.length!==visibleDerived.length && <button className="btn-show-all" onClick={()=>setShowAll(true)}>Show all {locations.length} locations</button>}
        {showAll && <button className="btn-show-all" onClick={()=>setShowAll(false)}>Collapse</button>}
        {paceMph && (
          <div className="summary-card">
            <h2>Current Pace Summary</h2>
            <div className="summary-grid">
              <div className="sum-item"><span className="sum-label">Weighted Pace</span><span className="sum-val">{(weightedPace||0).toFixed(2)} mph</span></div>
              <div className="sum-item"><span className="sum-label">Average Pace</span><span className="sum-val">{(avgPace||0).toFixed(2)} mph</span></div>
              <div className="sum-item"><span className="sum-label">Miles Done</span><span className="sum-val">{milesCompleted.toFixed(1)}</span></div>
              <div className="sum-item"><span className="sum-label">Miles Left</span><span className="sum-val">{(totalMiles-milesCompleted).toFixed(1)}</span></div>
              {predictions[predictions.length-1] && <div className="sum-item sum-finish"><span className="sum-label">Predicted Finish</span><span className="sum-val finish-time">{formatDateTime(predictions[predictions.length-1])}</span></div>}
              {elapsedHrs>0 && <div className="sum-item"><span className="sum-label">Est. Total Time</span><span className="sum-val">{formatDuration(elapsedHrs+(totalMiles-milesCompleted)/(paceMph||1))}</span></div>}
            </div>
          </div>
        )}
      </main>
    </div>
  );
    }
