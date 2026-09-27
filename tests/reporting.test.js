import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { computeCampaignStatistics } from '../worker/stats.js';
import { buildDriversExcelBase64 } from '../worker/excel.js';

const QUESTIONS = [
  { q: 'Q0', opts: ['a', 'b'], correct: 0 },
  { q: 'Q1', opts: ['a', 'b'], correct: 0 },
  { q: 'Q2', opts: ['a', 'b'], correct: 1 },
];

function attempt({ id, score, passed, answers }) {
  return {
    employee_id: id,
    first_name: `Driver${id}`,
    last_name: 'Test',
    employee_no: String(1000 + id),
    national_id: String(100000000 + id),
    score,
    correct_count: answers.filter((a) => a.isCorrect).length,
    passed: passed ? 1 : 0,
    submitted_at: '2026-09-27T10:00:00.000Z',
    answers_json: JSON.stringify(answers),
  };
}

// Driver 1: gets Q0 right, Q1 wrong, Q2 right
const a1 = attempt({
  id: 1, score: 67, passed: false,
  answers: [
    { questionIndex: 0, chosen: 0, correct: 0, isCorrect: true },
    { questionIndex: 1, chosen: 1, correct: 0, isCorrect: false },
    { questionIndex: 2, chosen: 1, correct: 1, isCorrect: true },
  ],
});
// Driver 2: gets everything right
const a2 = attempt({
  id: 2, score: 100, passed: true,
  answers: [
    { questionIndex: 0, chosen: 0, correct: 0, isCorrect: true },
    { questionIndex: 1, chosen: 0, correct: 0, isCorrect: true },
    { questionIndex: 2, chosen: 1, correct: 1, isCorrect: true },
  ],
});
// Driver 3: gets Q1 wrong too
const a3 = attempt({
  id: 3, score: 67, passed: false,
  answers: [
    { questionIndex: 0, chosen: 0, correct: 0, isCorrect: true },
    { questionIndex: 1, chosen: 1, correct: 0, isCorrect: false },
    { questionIndex: 2, chosen: 1, correct: 1, isCorrect: true },
  ],
});

describe('computeCampaignStatistics', () => {
  const stats = computeCampaignStatistics([a1, a2, a3], QUESTIONS);

  // 23 / 24. Only the attempts actually passed in are counted — the
  // caller (listAcceptedRequiredDriverAttempts) is what excludes testers
  // and guests, so feeding it only required-driver rows is what makes
  // this exclusion correct end-to-end.
  it('derives totals only from the given (required-driver) attempts', () => {
    expect(stats.totalCompleted).toBe(3);
    expect(stats.passedCount).toBe(1);
    expect(stats.failedCount).toBe(2);
  });

  it('computes average/median/high/low scores correctly', () => {
    expect(stats.averageScore).toBeCloseTo((67 + 100 + 67) / 3, 1);
    expect(stats.highestScore).toBe(100);
    expect(stats.lowestScore).toBe(67);
    expect(stats.medianScore).toBe(67);
  });

  // 25. Most-missed-question calculation
  it('identifies question index 1 as the most-missed question (2 of 3 wrong)', () => {
    expect(stats.mostMissedQuestions[0].index).toBe(1);
    expect(stats.mostMissedQuestions[0].missedCount).toBe(2);
    expect(stats.mostMissedQuestions[0].missedPercent).toBeCloseTo(66.7, 0);
  });

  it('does not invent statistics for a question nobody missed', () => {
    const q0 = stats.questionStats[0];
    expect(q0.missedCount).toBe(0);
    expect(q0.correctCount).toBe(3);
  });
});

describe('buildDriversExcelBase64', () => {
  // 22. Excel contains only the rows it was given (only required drivers,
  // since testers/guests are filtered out before this is called)
  it('produces a valid, readable .xlsx with exactly the given driver rows', () => {
    const base64 = buildDriversExcelBase64([a1, a2, a3], QUESTIONS.length);
    expect(typeof base64).toBe('string');
    expect(base64.length).toBeGreaterThan(0);

    const workbook = XLSX.read(base64, { type: 'base64' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    expect(rows).toHaveLength(4); // header + 3 drivers
    expect(rows[0]).toContain('שם פרטי');
    const names = rows.slice(1).map((r) => r[0]);
    expect(names).toEqual(['Driver1', 'Driver2', 'Driver3']);
  });
});
