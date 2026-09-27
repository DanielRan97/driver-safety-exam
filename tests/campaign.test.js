import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { tryClaimFinalReport, resetFinalReportGate } from '../worker/db/campaign.js';

describe('final report gate', () => {
  // 20. First claim succeeds
  it('the first claim succeeds', async () => {
    await resetFinalReportGate(env);
    const won = await tryClaimFinalReport(env);
    expect(won).toBe(true);
  });

  // 21. Cannot be triggered twice, including "concurrent" attempts
  it('a second claim (even concurrent) never wins once claimed', async () => {
    await resetFinalReportGate(env);
    const [a, b, c] = await Promise.all([
      tryClaimFinalReport(env),
      tryClaimFinalReport(env),
      tryClaimFinalReport(env),
    ]);
    const winners = [a, b, c].filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it('resetFinalReportGate allows a manual re-send afterward', async () => {
    await resetFinalReportGate(env);
    expect(await tryClaimFinalReport(env)).toBe(true);
    expect(await tryClaimFinalReport(env)).toBe(false);
    await resetFinalReportGate(env);
    expect(await tryClaimFinalReport(env)).toBe(true);
  });
});
