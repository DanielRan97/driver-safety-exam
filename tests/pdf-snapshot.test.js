import { it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createCompletedAttempt } from '../worker/db/attempts.js';
import { buildAttemptPdfData } from '../worker/admin/routes.js';

it('prepares old PDFs from saved wording and the original passing score', async () => {
  const questions = [{index:0,q:'Original wording',opts:['A','B','C','D'],correct:1}];
  const id = await createCompletedAttempt(env, {
    employeeId:null,isGuest:true,firstName:'Test',lastName:'Guest',nationalId:'11010519491231002X',
    submissionToken:crypto.randomUUID(),email:'test@example.com',dateField:'2026-09-29',lang:'en',
    score:100,correctCount:1,passed:true,passingScoreAtSubmission:80,submittedAt:new Date().toISOString(),
    questionsSnapshot:JSON.stringify(questions),answersJson:JSON.stringify([{chosen:1}]),statisticsJson:'{}',
  });
  const stored = await env.DB.prepare('SELECT * FROM exam_attempts WHERE id=?').bind(id).first();
  const data = buildAttemptPdfData(stored);
  expect(data.questions).toEqual(questions);
  expect(data.submission).toMatchObject({passingScore:80,score:100,answers:[1]});
});
