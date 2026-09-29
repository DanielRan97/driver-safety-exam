import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { isValidNationalId, normalizeNationalId } from '../worker/validate.js';
import { findEmployeeByNationalId, countCompletedRequiredDrivers } from '../worker/db/employees.js';
import { createCompletedAttempt, listAcceptedRequiredDriverAttempts } from '../worker/db/attempts.js';
import { handleOverview, handleStatistics } from '../worker/admin/routes.js';
import { randomValidIsraeliId } from './helpers/national-id.js';

async function employee({ active = 1, required = 1 } = {}) {
  const nationalId = randomValidIsraeliId('0');
  await env.DB.prepare(`INSERT INTO employees
    (first_name,last_name,employee_no,national_id,role,is_required,is_active,created_at)
    VALUES ('Test','Driver','9000',?,'driver',?,?,CURRENT_TIMESTAMP)`).bind(nationalId, required, active).run();
  return findEmployeeByNationalId(env, nationalId);
}

function payload(id, overrides = {}) {
  return { first:'李',last:'王',email:'guest@example.com',id,empnum:'',date:'2026-09-29',lang:'zh',
    answers:Array(20).fill(0),submissionToken:crypto.randomUUID(),...overrides };
}

async function post(path, data) {
  const response = await SELF.fetch('https://example.com' + path, {
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),
  });
  return { status:response.status, body:await response.json() };
}

async function snapshot() {
  return { overview:await (await handleOverview(env)).json(), stats:await (await handleStatistics(env)).json() };
}

async function storedAttempt(driver, overrides = {}) {
  return createCompletedAttempt(env, {
    employeeId:driver.id,isGuest:false,firstName:'Test',lastName:'Driver',nationalId:driver.national_id,
    submissionToken:crypto.randomUUID(),email:'test@example.com',dateField:'2026-09-29',lang:'he',
    score:0,correctCount:0,passed:false,submittedAt:'2026-09-29T12:00:00.000Z',
    questionsSnapshot:'[]',answersJson:'[]',statisticsJson:'{}',...overrides,
  });
}

describe('driver and guest separation', () => {
  it('requires the matching employee number before verification or submission, including retries', async () => {
    const driver = await employee();
    const before = await snapshot();
    const data = payload(driver.national_id, {empnum:driver.employee_no});
    for (const [empnum, error] of [[undefined,'employee_number_required'],['','employee_number_required'],['9001','employee_number_mismatch']]) {
      const verify = await post('/api/employee/verify',{nationalId:driver.national_id,empnum});
      expect(verify.status).toBe(400);
      expect(verify.body.status).toBe(error);
      expect(verify.body.employee).toBeUndefined();
      const submit = await post('/api/submit',{...data,empnum});
      expect(submit.status).toBe(400);
      expect(submit.body.error).toBe(error);
    }
    expect(await snapshot()).toEqual(before);
    const verification = await post('/api/employee/verify',{nationalId:driver.national_id,empnum:driver.employee_no});
    expect(verification.body.status).toBe('ok');
    expect((await post('/api/submit',data)).body.isGuest).toBe(false);
    expect((await post('/api/submit',{...data,empnum:''})).body.error).toBe('employee_number_required');
    expect((await post('/api/submit',data)).body.ok).toBe(true);
  });

  it('normalizes leading zeros and lowercase X, and rejects all-zero IDs', () => {
    expect(normalizeNationalId(' 52562568 ')).toBe('052562568');
    expect(normalizeNationalId('11010519491231002x')).toBe('11010519491231002X');
    expect(isValidNationalId('0')).toBe(false);
    expect(isValidNationalId('000000000')).toBe(false);
  });

  it('identifies and saves a listed driver even when the leading zero is omitted', async () => {
    const driver = await employee();
    const shortId = driver.national_id.replace(/^0+/, '');
    const verify = await post('/api/employee/verify', {nationalId:shortId,empnum:driver.employee_no});
    expect(verify.body.status).toBe('ok');
    const data = payload(shortId,{empnum:driver.employee_no});
    const result = await post('/api/submit', data);
    expect(result.body.isGuest).toBe(false);
    const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE submission_token=?').bind(data.submissionToken).first();
    expect(row.employee_id).toBe(driver.id);
    expect(row.national_id).toBe(driver.national_id);
    const again = await post('/api/employee/verify', {nationalId:shortId,empnum:driver.employee_no});
    expect(again.body.status).toBe('blocked');
    expect(again.body.message).not.toContain('בהצלחה');
  });

  it('saves a Chinese guest separately without changing ANY driver statistics', async () => {
    const before = await snapshot();
    const data = payload('11010519491231002x');
    const response = await post('/api/submit', data);
    expect(response.body.ok).toBe(true);
    expect(response.body.isGuest).toBe(true);
    const row = await env.DB.prepare('SELECT * FROM exam_attempts WHERE submission_token=?').bind(data.submissionToken).first();
    expect(row.is_guest).toBe(1);
    expect(row.employee_id).toBeNull();
    expect(row.first_name).toBe('李');
    expect(await snapshot()).toEqual(before);
  });

  it('treats non-required employees as guests, and excludes inactive drivers', async () => {
    const other = await employee({required:0});
    const inactive = await employee({active:0});
    const before = await snapshot();
    for (const person of [other,inactive]) {
      expect((await post('/api/employee/verify',{nationalId:person.national_id})).body.status).toBe('guest');
      expect((await post('/api/submit',payload(person.national_id))).body.isGuest).toBe(true);
    }
    await storedAttempt(inactive);
    expect(await snapshot()).toEqual(before);
  });

  it('counts only the latest attempt when timestamps are identical', async () => {
    const driver = await employee();
    const before = await countCompletedRequiredDrivers(env);
    await storedAttempt(driver);
    const newest = await storedAttempt(driver,{score:100,correctCount:20,passed:true});
    const rows = (await listAcceptedRequiredDriverAttempts(env)).filter(a => a.employee_id === driver.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(newest);
    expect(await countCompletedRequiredDrivers(env)).toBe(before+1);
  });

  it('rejects incomplete or invalid answer values without consuming an attempt', async () => {
    const driver = await employee();
    for (const value of [null,4,-1,'1']) {
      const data = payload(driver.national_id);
      data.answers[0] = value;
      expect((await post('/api/submit',data)).status).toBe(400);
    }
    expect((await post('/api/employee/verify',{nationalId:driver.national_id,empnum:driver.employee_no})).body.status).toBe('ok');
  });

  it('returns the stored result on retry and prevents reuse by another identity', async () => {
    const data = payload(randomValidIsraeliId('7'));
    const first = await post('/api/submit',data);
    const retry = await post('/api/submit',{...data,answers:Array(20).fill(3)});
    expect(retry.body).toEqual(first.body);
    const different = await post('/api/submit',{...data,id:randomValidIsraeliId('6')});
    expect(different.status).toBe(409);
  });
});
