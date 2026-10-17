'use strict';

// Parameters of a command's "Syntax Description" table, from `pdftotext
// -layout` text that keeps its real columns (see sectionColumns in
// scripts/extract-commands.js — the label itself is blanked to spaces, not
// cut off, so every line's indentation is an absolute column).
//
// The table has a name column and a description column. A row starts in the
// name column; wrapped description text continues further right, aligned
// under the description's start. Rows are therefore told apart by
// indentation, not by the gap between name and description: a name wider
// than its column (e.g. `name vlan_name` in `switchport voice vlan`) leaves
// only one space before the description, which the gap rule alone would read
// as a continuation of the previous row.

const reEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const collapseWs = (s) => s.replace(/\s+/g, ' ').trim();
const indentOf = (line) => line.length - line.trimStart().length;

const NO_ARGS = /^This command has no (?:arguments|keywords)/i;
// Name and description separated by the usual 2+ space column gap.
const GAP_ROW = /^(\S+(?:\s\S+){0,3}?)\s{2,}(\S.*)$/;
// A lone row is sometimes laid out with a single space (no table to align).
const SINGLE_ROW = /^(\S+)\s+(\S.*)$/;
// A long name (more than four words, e.g. `switch {switch_num | active |
// standby }`) still has the column gap; split at the first one.
const WIDE_GAP_ROW = /^(\S.{0,58}?\S)\s{2,}(\S.*)$/;
// Rows whose description starts with "(Optional)" can always be split there.
const OPTIONAL_ROW = /^(\S+(?:\s\S+){0,3}?)\s+(\(Optional\)\s*\S.*)$/;

// Some entries put the whole command into the table instead of just its
// argument: `switchport voice vlanvlan_id Specifies ...` (argument glued on)
// or `switchport mode access Sets the interface ...` (no argument at all).
// Cut the command name off; what is left is either `<argument> <Description>`
// or just a description of the command itself (no parameter).
const ARG_THEN_DESC = /^([a-z<{[][^\s]*)\s+([A-Z(].*)$/;

// A table that runs across a page break carries the page furniture in
// between: the footer ("Command Reference, Cisco IOS XE ..."), the page
// number, the chapter title and the next page's running header (the command
// name), in varying order. Removed in place so none of it ends up in a
// parameter description.
const FOOTER = /^Command Reference, Cisco IOS\b/;
function dropPageFurniture(lines, commandName) {
  const cmd = commandName.trim().toLowerCase();
  for (let k = 0; k < lines.length; k++) {
    if (!FOOTER.test(lines[k].trim())) continue;
    // Up to the running header (the command name) when it follows closely;
    // otherwise just the footer and page-number lines.
    let end = k;
    const header = cmd
      ? lines.slice(k + 1, k + 5).findIndex((l) => l.trim().toLowerCase() === cmd)
      : -1;
    if (header >= 0) end = k + 1 + header;
    else while (end + 1 < lines.length && /^\d{1,4}$/.test(lines[end + 1].trim())) end++;
    lines.splice(k, end - k + 1);
    k--;
  }
}

function extractParams(text, commandName = '') {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    // Some entries repeat the label in front of the table; blank it like the
    // first one so it is neither a parameter nor a wrong name column.
    .map((l) => l.replace(/^\s*Syntax Description\b/, (m) => ' '.repeat(m.length)))
    .filter((l) => l.trim() !== '');
  dropPageFurniture(lines, commandName);
  if (lines.length === 0) return [];
  if (lines.length === 1 && NO_ARGS.test(lines[0].trim())) return [];

  // Column state, re-measured at every clean row: after a page break the
  // table continues shifted (e.g. names at column 28 instead of 21).
  let nameCol = indentOf(lines[0]);
  let descCol = null;
  // A row starts in the name column (pdftotext occasionally shifts it by
  // one), or — after a page break — with a name/description gap clearly left
  // of the description column. Text starting in the description column is a
  // continuation, even when it has a gap ("Note   This keyword ...").
  const isRowStart = (line) => {
    const ind = indentOf(line);
    if (ind <= nameCol + 1) return true;
    return GAP_ROW.test(line.trim()) && descCol !== null && ind < descCol - 2;
  };
  const firstCol = nameCol;
  const rowCount = lines.filter((l) => indentOf(l) <= firstCol + 1).length;

  const params = [];
  let skipping = false; // continuation lines of a row dropped as "describes the command"
  const cmd = commandName.trim().toLowerCase();
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    const content = line.trim();
    const rowStart = isRowStart(line);
    if (rowStart) {
      const gap = GAP_ROW.exec(content);
      if (gap) {
        nameCol = indentOf(line);
        descCol = line.length - gap[2].length;
      }
    }
    if (!rowStart) {
      if (skipping) continue;
      if (params.length > 0) {
        const last = params[params.length - 1];
        last.description = collapseWs(`${last.description} ${content}`);
      }
      continue;
    }
    skipping = false;
    // Only multi-word commands: a single-word command's parameter is often
    // named like it (`description`, `exporter` → `exporter-name`). The name
    // must end at a space or run straight into the argument (`vlanvlan_id`).
    if (cmd.includes(' ') && new RegExp(`^${reEscape(cmd)}(?=\\s|[a-z])`, 'i').test(content)) {
      const rest = content.slice(cmd.length).trim();
      const arg = ARG_THEN_DESC.exec(rest);
      if (arg) params.push({ name: arg[1], description: arg[2].trim() });
      else skipping = true;
      continue;
    }
    let m = GAP_ROW.exec(content) || WIDE_GAP_ROW.exec(content);
    if (!m) {
      // Overflowing name: the next line, if it continues this row, starts at
      // the column where this row's description starts.
      const next = lines[k + 1];
      const contCol = next !== undefined && !isRowStart(next) ? indentOf(next) : -1;
      if (contCol > indentOf(line) && contCol < line.length && line[contCol - 1] === ' ') {
        const name = line.slice(indentOf(line), contCol).trim();
        const description = line.slice(contCol).trim();
        // Only where the description visibly starts there (capital or
        // "(Optional)"): bulleted continuations are indented deeper than the
        // description's start and would cut it mid-sentence ("level The").
        if (name && /^[A-Z(]/.test(description)) m = [line, name, description];
      }
    }
    if (!m) m = OPTIONAL_ROW.exec(content);
    if (!m && rowCount === 1) m = SINGLE_ROW.exec(content);
    if (m) {
      params.push({ name: m[1].trim(), description: m[2].trim() });
    } else if (params.length > 0) {
      // Can't split it: keep the text rather than invent a parameter.
      const last = params[params.length - 1];
      last.description = collapseWs(`${last.description} ${content}`);
    }
  }
  return params;
}

module.exports = { extractParams };
