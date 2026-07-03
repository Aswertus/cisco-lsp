'use strict';

// Free-text regions inside IOS configs — lines that are data, not commands.
// No scanner may treat them as config: they are not commands, their layout
// is deliberate, and words inside them must not create cross-references.
// Every line-scanning module shares this tracker so they can never disagree
// about where a region ends. Two kinds exist:
//
// 1. Banner blocks (`banner motd ^C ... ^C`, `banner login #...#`): free
//    text between two delimiter marks — ASCII art, contact info, anything.
//    The delimiter is whatever follows the banner type: a single character
//    (`#`, `%`, ...) or the two-character caret notation `^C` that text
//    configs use for the real ETX control character IOS shows as ^C.
//
// 2. Certificate payloads inside `crypto pki certificate chain` blocks: a
//    `certificate ...` line is followed by hex dump lines and a terminating
//    `quit`.

const BANNER_OPENER_RE = /^banner\s+[a-z-]+\s+(\S)(\S?)(.*)$/i;
const CERT_OPENER_RE = /^certificate\s+(?!chain\b)\S/i;

// Returns isFreeTextLine(line, trimmed): call once per line, in order.
// - opener line (`banner login ^C`, `certificate ca 01`) → false (it's a
//   real command; free-text state is armed)
// - body line → true
// - closing line (banner end delimiter / `quit`) → true
function createFreeTextTracker() {
  let bannerDelim = null;
  let inCert = false;

  return function isFreeTextLine(line, trimmed) {
    if (bannerDelim !== null) {
      if (line.includes(bannerDelim)) bannerDelim = null;
      return true;
    }
    if (inCert) {
      if (/^quit$/i.test(trimmed)) inCert = false;
      return true;
    }

    const banner = BANNER_OPENER_RE.exec(trimmed);
    if (banner) {
      const d = banner[1] === '^' && banner[2] ? banner[1] + banner[2] : banner[1];
      const rest = (banner[1] + banner[2] + banner[3]).slice(d.length);
      // One-liner (`banner motd #No access#`) closes on the opener itself.
      if (!rest.includes(d)) bannerDelim = d;
    } else if (CERT_OPENER_RE.test(trimmed)) {
      inCert = true;
    }
    return false;
  };
}

module.exports = { createFreeTextTracker };
