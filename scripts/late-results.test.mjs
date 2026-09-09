import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDecodedLog } from './inspect-late-results.mjs';

const id = '123456789abcdef';
const join = `1.00 [D] AcesMpContext: AcesApp::onJoinMatch : sessionId:${id}`;
const reward = '2.00 [D] received SessionStats sum WP: total[1200]';
const end = '2.00 [D] AcesMission::endFinally 3 -1.000000';

test('late-result diagnostics expose only allowlisted summaries, not source payloads', () => {
  const result = inspectDecodedLog([join, reward, end,
    '4.00 UserLogStorage: removing notifications; token=MUST_NOT_LEAK',
    '10.00 {"roomId":"123456789abcdef","wpEarned":6000,"win":true,"name":"PRIVATE_NAME","credential":"PRIVATE_SECRET"}',
  ].join('\n'));
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /MUST_NOT_LEAK|PRIVATE_|credential|6000/);
  assert.equal(result.fields.wpEarned, 1);
  assert.equal(result.matches[0].lateReferences, 1);
  assert.equal(result.matches[0].lateFields.wpEarned, 1);
  assert.deepEqual(result.matches[0].statuses, []);
});

test('match references recognize decimal room IDs as well as hexadecimal IDs', () => {
  const decimal = BigInt(`0x${id}`).toString();
  const result = inspectDecodedLog([join, end, `5.50 roomId:${decimal}`, `8.00 roomId:'${id}'`,
    `11.00 irrelevant:x${id}z`, `12.00 unrelated:9${decimal}9`].join('\n'));
  assert.equal(result.matches[0].lateReferences, 2);
  assert.equal(result.matches[0].lastReference, 8);
});

test('anonymous late rewards and unrelated later statuses cannot finalize a departed match', () => {
  const result = inspectDecodedLog([join, reward, end,
    '90.00 [D] received SessionStats sum WP: total[9000]',
    '90.01 [D] AcesMission::setStatus MISSION_STATUS_RUNNING -> MISSION_STATUS_SUCCESS',
  ].join('\n'));
  assert.equal(result.matches[0].rewards.length, 1);
  assert.deepEqual(result.matches[0].statuses, []);
  assert.equal(result.unattributedRewards[0].total, 9000);
});

test('adjacent terminal status is reported without treating maintenance activity as a result', () => {
  const result = inspectDecodedLog([join, reward, end,
    '2.01 [D] AcesMission::setStatus MISSION_STATUS_RUNNING -> MISSION_STATUS_FAIL',
    '900.00 UserLogStorage: maintenance',
  ].join('\n'));
  assert.deepEqual(result.matches[0].statuses, [{ seconds: 2.01, outcome: 'FAIL' }]);
  assert.equal(result.fields.UserLogStorage, 1);
  assert.equal(inspectDecodedLog('').matches.length, 0);
});
