'use strict';
const test = require('node:test');
const assert = require('node:assert');

const BASE_URL = 'http://localhost:3000/api/v1';

test('CAMS Integration & Security Suite', async (t) => {
  let adminCookie = '';
  let presidentCookie = '';

  await t.test('1. Super Admin authentication', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rekha.iyer@nitt.edu',
        password: 'Admin@1234',
        roleTab: 'superadmin'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.systemRole, 'superadmin');

    const setCookie = res.headers.get('set-cookie');
    assert.ok(setCookie);
    adminCookie = setCookie.split(';')[0];
  });

  await t.test('2. Role mismatch rejection (Security check)', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'rekha.iyer@nitt.edu',
        password: 'Admin@1234',
        roleTab: 'president' // Wrong tab
      })
    });
    assert.strictEqual(res.status, 401);
    const data = await res.json();
    assert.strictEqual(data.success, false);
  });

  await t.test('3. Club President authentication', async () => {
    const res = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'arjun.mehta@college.edu',
        password: 'Pres@1234',
        roleTab: 'president'
      })
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.user.systemRole, 'president');

    const setCookie = res.headers.get('set-cookie');
    presidentCookie = setCookie.split(';')[0];
  });

  await t.test('4. RBAC: President cannot view admin audit log', async () => {
    const res = await fetch(`${BASE_URL}/audit`, {
      headers: { Cookie: presidentCookie }
    });
    assert.strictEqual(res.status, 403);
  });

  await t.test('5. RBAC: Super Admin can view audit log', async () => {
    const res = await fetch(`${BASE_URL}/audit`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.data));
  });

  await t.test('6. Public Ticker endpoint is accessible without auth', async () => {
    const res = await fetch(`${BASE_URL}/ticker`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.ticker));
  });

  await t.test('7. Validation error handling (Invalid email on forgot-password)', async () => {
    const res = await fetch(`${BASE_URL}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email' })
    });
    assert.strictEqual(res.status, 422);
    const data = await res.json();
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.code, 'VALIDATION_ERROR');
  });

  await t.test('8. Report generation (PDF & Excel download check)', async () => {
    const resPdf = await fetch(`${BASE_URL}/reports/clubs?format=pdf`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(resPdf.status, 200);
    assert.strictEqual(resPdf.headers.get('content-type'), 'application/pdf');

    const resExcel = await fetch(`${BASE_URL}/reports/clubs?format=excel`, {
      headers: { Cookie: adminCookie }
    });
    assert.strictEqual(resExcel.status, 200);
    assert.ok(resExcel.headers.get('content-type').includes('spreadsheetml'));
  });
});
