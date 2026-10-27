// Temporal event history -> the few steps a visitor should see. Pure (no I/O) so it is unit-tested.
// The CLI's JSON prints eventType as EVENT_TYPE_WORKFLOW_EXECUTION_STARTED; older exports use
// WorkflowExecutionStarted. Both are normalised to PascalCase before matching.

const LABELS = {
  WorkflowExecutionStarted: 'Workflow gestartet',
  ActivityTaskScheduled: 'Aufgabe eingeplant',
  ActivityTaskStarted: 'Aufgabe gestartet',
  ActivityTaskCompleted: 'Aufgabe abgeschlossen',
  WorkflowExecutionCompleted: 'Workflow abgeschlossen ✓',
};

/** EVENT_TYPE_ACTIVITY_TASK_STARTED | ActivityTaskStarted -> ActivityTaskStarted */
export function pascalEventType(raw) {
  const s = String(raw || '').replace(/^EVENT_TYPE_/, '');
  if (!s) return '';
  if (!s.includes('_') && /[a-z]/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
  return s.toLowerCase().split('_').filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

/** events[] of `temporal workflow show -o json` -> [{ label, id, extra, recover }] */
export function parseTimeline(events) {
  const steps = [];
  for (const e of Array.isArray(events) ? events : []) {
    const label = LABELS[pascalEventType(e && e.eventType)];
    if (!label) continue;
    const att = e.activityTaskStartedEventAttributes;
    const attempt = att && Number(att.attempt);
    const recover = !!(attempt && attempt > 1);
    steps.push({ label, id: e.eventId, extra: attempt ? `Versuch ${attempt}${recover ? ' (nach Heartbeat-Timeout — neuer Worker übernimmt)' : ''}` : '', recover });
  }
  return steps;
}

/** What may be claimed about a parsed history. */
export function judgeTimeline(steps) {
  if (!steps.length) return { ok: false, message: 'Der Ablauf-Verlauf enthält keine auswertbaren Ereignisse.' };
  const recovered = steps.some((s) => s.recover);
  return { ok: true, recovered, message: recovered ? `echt · ${steps.length} Ereignisse — Ausfall und Neustart durch einen zweiten Worker im Verlauf belegt` : `${steps.length} Ereignisse — aber kein zweiter Versuch im Verlauf` };
}

/** Give the bundle's run_demo.sh this run's own Temporal ports (it hardcodes 7233/8233). */
export function patchTemporalPorts(script, port, uiPort) {
  if (!script.includes('7233') || !script.includes('8233')) return null;
  return script.split('7233').join(String(port)).split('8233').join(String(uiPort));
}
