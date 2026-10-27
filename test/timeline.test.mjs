import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimeline, pascalEventType, judgeTimeline } from '../lib/timeline.mjs';

const ev = (id, eventType, extra = {}) => ({ eventId: String(id), eventType, ...extra });
// Shape of `temporal workflow show -o json` for the kill-a-worker run.
const HISTORY = [
  ev(1, 'EVENT_TYPE_WORKFLOW_EXECUTION_STARTED'),
  ev(2, 'EVENT_TYPE_WORKFLOW_TASK_SCHEDULED'),
  ev(5, 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED'),
  ev(6, 'EVENT_TYPE_ACTIVITY_TASK_STARTED', { activityTaskStartedEventAttributes: { attempt: 1 } }),
  ev(7, 'EVENT_TYPE_ACTIVITY_TASK_STARTED', { activityTaskStartedEventAttributes: { attempt: 2 } }),
  ev(8, 'EVENT_TYPE_ACTIVITY_TASK_COMPLETED'),
  ev(11, 'EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED'),
];

test('pascalEventType handles UPPER_SNAKE with prefix, bare UPPER_SNAKE and PascalCase', () => {
  assert.equal(pascalEventType('EVENT_TYPE_ACTIVITY_TASK_STARTED'), 'ActivityTaskStarted');
  assert.equal(pascalEventType('WORKFLOW_EXECUTION_STARTED'), 'WorkflowExecutionStarted');
  assert.equal(pascalEventType('WorkflowExecutionStarted'), 'WorkflowExecutionStarted');
  assert.equal(pascalEventType(undefined), '');
});

test('real UPPER_SNAKE history yields the 6 visible steps, the retry is marked as recovery', () => {
  const steps = parseTimeline(HISTORY);
  assert.deepEqual(steps.map((s) => s.label), ['Workflow gestartet', 'Aufgabe eingeplant', 'Aufgabe gestartet', 'Aufgabe gestartet', 'Aufgabe abgeschlossen', 'Workflow abgeschlossen ✓']);
  assert.deepEqual(steps.map((s) => s.recover), [false, false, false, true, false, false]);
  assert.match(steps[3].extra, /Versuch 2/);
  const j = judgeTimeline(steps);
  assert.ok(j.ok && j.recovered);
});

test('an empty or unreadable history is a failure, never a success with 0 events', () => {
  for (const bad of [[], undefined, null, [ev(1, 'EVENT_TYPE_SOMETHING_ELSE')]]) {
    const j = judgeTimeline(parseTimeline(bad));
    assert.equal(j.ok, false);
  }
});

test('a history without a second attempt does not claim a recovery', () => {
  const j = judgeTimeline(parseTimeline(HISTORY.filter((e) => e.eventId !== '7')));
  assert.ok(j.ok);
  assert.equal(j.recovered, false);
  assert.ok(!/belegt/.test(j.message));
});

import { patchTemporalPorts } from '../lib/timeline.mjs';
test('patchTemporalPorts rewrites every hardcoded port and refuses an unknown script', () => {
  const src = '--port 7233 --ui-port 8233\nwaiting for 127.0.0.1:7233\n--address 127.0.0.1:7233';
  const out = patchTemporalPorts(src, 41001, 41002);
  assert.ok(!/7233|8233/.test(out));
  assert.equal((out.match(/41001/g) || []).length, 3);
  assert.equal(patchTemporalPorts('echo hi', 1, 2), null);
});
