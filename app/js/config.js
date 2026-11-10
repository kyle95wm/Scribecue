// How this copy of Scribecue is being run. The GitHub Pages build sets HOSTED to true:
// there it's a web app that installs from the browser, works offline and updates itself,
// so the git and Docker update steps don't apply. Run from Docker, it stays false.
export const HOSTED = false;

// Where this Scribecue lives. A fork changes these three, then runs scripts/check.sh:
// tests/addresses.test.mjs names every other file that has to match, such as the
// Content-Security-Policy and the relay's settings.
// The GitHub repository, as owner/name: releases, the update check and guide links.
export const REPO = 'kyle95wm/Scribecue';
// The web version, with its closing slash. Share links made on localhost point here.
export const WEB_APP = 'https://scribecue.kyleadvoice.ca/';
// The sharing relay (relay/). A developer setting can point elsewhere for one browser.
export const RELAY = 'wss://share.kyleadvoice.ca';
