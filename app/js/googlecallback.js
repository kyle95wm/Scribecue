// google.html: where Google sends people back after connecting Google Drive. It passes the
// code to the Scribecue window that asked (googledrive.js), then closes.
import { CHANNEL } from './drivesync.js';

const q = new URLSearchParams(location.search);
const ch = new BroadcastChannel(CHANNEL);
ch.postMessage({ state: q.get('state') || '', code: q.get('code') || '', error: q.get('error') || '' });
ch.close();
history.replaceState(null, '', location.pathname); // the code shouldn't stay in the address
document.getElementById('msg').textContent = q.get('code')
  ? 'Google Drive is connected. You can close this window.'
  : 'Google Drive wasn’t connected. You can close this window.';
setTimeout(() => window.close(), 300);
