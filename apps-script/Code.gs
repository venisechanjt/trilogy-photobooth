/**
 * Anonymous "favourite frame" votes, stored in the Google Sheet this script is attached to.
 *
 * Each vote is one row in the "Votes" sheet: [timestamp, frameId]. Nothing else is stored.
 *
 * Deploy: Deploy > New deployment > Web app, Execute as: Me, Who has access: Anyone.
 * See VOTING_SETUP.md.
 */

var SHEET_NAME = 'Votes';

// Must match the ids in public/vote.js
var FRAME_IDS = [
  '3c-green', '3c-sweet-treats-brown', '3c-blue', '3c-camera-light-blue', '3c-red-hearts', '3c-white',
  '4c-white', '4c-green', '4c-brown-bear', '4c-light-green', '4c-dark-green', '4c-red-hearts',
];

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['timestamp', 'frameId']);
  }
  return sh;
}

// Vote: body is JSON sent as text/plain (no CORS preflight), e.g. {"frameId":"3c-green"}
function doPost(e) {
  var frameId;
  try {
    frameId = JSON.parse(e.postData.contents).frameId;
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  if (FRAME_IDS.indexOf(frameId) < 0) return json_({ ok: false, error: 'unknown frame' });

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    return json_({ ok: false, error: 'busy, try again' });
  }
  try {
    sheet_().appendRow([new Date(), frameId]);
  } finally {
    lock.releaseLock();
  }
  return json_({ ok: true });
}

// Tally: {"3c-green": 4, ..., "total": 17}
function doGet(e) {
  var tally = {};
  FRAME_IDS.forEach(function (id) { tally[id] = 0; });
  var total = 0;
  var sh = sheet_();
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, 2, last - 1, 1).getValues().forEach(function (row) {
      if (tally.hasOwnProperty(row[0])) {
        tally[row[0]]++;
        total++;
      }
    });
  }
  tally.total = total;
  return json_(tally);
}
