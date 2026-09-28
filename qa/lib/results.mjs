// ─── What happened, as it happens ───────────────────────────────
//
// pass          checked and correct
// fail          checked and wrong — the run exits non-zero
// inconclusive  could not be judged fairly (Groq rate-limited the step the
//               answer depended on); retried on a later run, never a failure
// deferred      not asked, to protect the free budget
// skipped       not applicable this run (a prerequisite failed, or no token)
// known         a real defect that is already understood: listed in every
//               report so it cannot be forgotten, but not failing the run,
//               so red keeps meaning "something new broke". When the defect
//               is fixed the check passes and the report says so.
// ────────────────────────────────────────────────────────────────

const ICON = { pass: '✅', fail: '❌', inconclusive: '⚠️', deferred: '⏸️', skipped: '➖', known: '🐞' };

export class Results {
  constructor() {
    this.checks = [];
    this.notes = [];
  }

  add(area, id, title, status, detail = {}) {
    this.checks.push({ area, id, title, status, ...detail });
    const why = detail.why ? ` — ${detail.why}` : '';
    console.log(`  ${ICON[status] ?? '?'} [${area}] ${title}${why}`);
    return status;
  }

  note(area, text) {
    this.notes.push({ area, text });
    console.log(`  ℹ️  [${area}] ${text}`);
  }

  inArea(area) {
    return this.checks.filter((c) => c.area === area);
  }

  get failed() {
    return this.checks.filter((c) => c.status === 'fail');
  }
}

export { ICON };
