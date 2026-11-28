import { getStore } from '@netlify/blobs';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

function normalizePin(value) {
  return String(value ?? '').replace(/[^0-9]/g, '');
}

function samePin(provided, expected) {
  if (!provided || !expected) return false;
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(provided), digest(expected));
}

const sessionCookie = '__Host-powerlifting-trainer';
const sessionSeconds = 8 * 60 * 60;

function response(value, status = 200, cookie) {
  const headers = { 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(value, { status, headers });
}

function trainerCookie(value, seconds) {
  return sessionCookie + '=' + value + '; Max-Age=' + seconds +
    '; Path=/; HttpOnly; Secure; SameSite=Strict';
}

function signSession(expires, secret) {
  return createHmac('sha256', secret).update('powerlifting:trainer:' + expires).digest('base64url');
}

function hasTrainerSession(request, secret) {
  if (!secret) return false;
  const cookie = (request.headers.get('cookie') || '').split(';')
    .map(value => value.trim()).find(value => value.startsWith(sessionCookie + '='));
  if (!cookie) return false;
  const [expires, signature] = cookie.slice(sessionCookie.length + 1).split('.');
  const now = Math.floor(Date.now() / 1000);
  return /^\d{10}$/.test(expires) && Number(expires) > now &&
    Number(expires) <= now + sessionSeconds &&
    samePin(signature, signSession(expires, secret));
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeDays(oldDays, newDays) {
  const days = { ...oldDays };
  for (const [id, day] of Object.entries(object(newDays))) {
    if (!/^[a-z0-9_-]{1,100}$/i.test(id) || id === '__proto__' || !day || typeof day !== 'object' || Array.isArray(day)) continue;
    const previous = days[id];
    if (previous && Number(previous.savedAt || 0) > Number(day?.savedAt || 0)) continue;
    days[id] = day;
  }
  return days;
}

function mergeStats(oldStats, newStats) {
  const previous = object(oldStats);
  const incoming = object(newStats);
  const merged = {};
  for (const key of ['opens','dayOpens','pushes','lastSeen']) {
    merged[key] = Math.max(Number(previous[key]) || 0, Number(incoming[key]) || 0);
  }
  merged.firstSeen = Math.min(Number(previous.firstSeen) || Infinity,
    Number(incoming.firstSeen) || Infinity, Date.now());
  return merged;
}

function summarize(progress) {
  const days = Object.values(progress);
  return {
    daysCount: days.length,
    commentCount: days.filter(day => day?.comment?.text).length,
    rpeCount: days.filter(day => day?.comment?.rpe).length,
    adjustCount: days.filter(day => day?.adjust).length,
    setEditCount: days.filter(day => Object.keys(object(day?.setEdits)).length).length,
  };
}

export function createHandler({ openStore, openProgramStore, readLegacy, adminPin }) {
  const programKey = 'current';
  async function readProgram() {
    return openProgramStore ? openProgramStore().get(programKey, { type: 'json' }) : null;
  }
  return async function handler(request) {
    if (request.method !== 'POST') return response({ error: 'Метод не поддерживается' }, 405);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return response({ error: 'Запрос отклонён' }, 403);
    let body;
    try {
      const text = await request.text();
      if (text.length > 500_000) return response({ error: 'Слишком большой объём данных ученика' }, 413);
      body = JSON.parse(text);
    } catch {
      return response({ error: 'Некорректные данные' }, 400);
    }
    const { action, pin: provided, progress, stats } = object(body);
    const pin = normalizePin(provided);
    if (action === 'trainer-login') {
      if (!adminPin) return response({ error: 'Вход тренера не настроен в Netlify' }, 503);
      if (!samePin(String(provided ?? ''), adminPin)) {
        return response({ error: 'Неверный PIN или пароль' }, 401);
      }
      const expires = Math.floor(Date.now() / 1000) + sessionSeconds;
      return response({ ok: true }, 200,
        trainerCookie(expires + '.' + signSession(expires, adminPin), sessionSeconds));
    }
    if (action === 'trainer-logout') return response({ ok: true }, 200, trainerCookie('', 0));
    if (action === 'list' || action === 'trainer-session') {
      if (!hasTrainerSession(request, adminPin)) {
        return response({ error: 'Войдите в админку, чтобы загрузить отзывы' }, 401);
      }
      if (action === 'trainer-session') return response({ ok: true });
    }
    if (action === 'publish-program' || action === 'read-program') {
      if (action === 'publish-program' && !hasTrainerSession(request, adminPin)) {
        return response({ error: 'Войдите в админку, чтобы опубликовать программу' }, 401);
      }
      try {
        if (action === 'publish-program') {
          const { users, workouts } = body;
          if (!Array.isArray(users) || !Array.isArray(workouts) || !workouts.length ||
              users.some(user => !user || !normalizePin(user.pin)) ||
              workouts.some(workout => !workout || !workout.id || !Array.isArray(workout.blocks))) {
            return response({ error: 'Проверьте список учеников и тренировок перед публикацией' }, 400);
          }
          await openProgramStore().setJSON(programKey, { users, workouts });
          return response({ ok: true });
        }
        const program = await readProgram();
        if (!program) return response({ error: 'Новая программа ещё не опубликована' }, 404);
        return response(program);
      } catch (error) {
        console.error('training-program', { action, name: error?.name });
        return response({ error: 'Хранилище программы временно недоступно' }, 503);
      }
    }
    if (!['list','save','stats'].includes(action)) return response({ error: 'Неизвестное действие' }, 400);
    let stage = 'legacy-read';
    try {
      const legacy = await readLegacy();
      stage = 'program-read';
      const program = await readProgram();
      const users = program?.users ?? legacy.users;
      if (!Array.isArray(users)) throw new Error('Missing users');
      stage = 'blob-connect';
      const store = openStore();
      stage = 'blob-read';
      if (action === 'list') {
        const allProgress = { ...object(legacy.progress) };
        const submissions = { ...object(legacy.submissions) };
        await Promise.all(users.map(async user => {
          const key = normalizePin(user.pin);
          if (!key) return;
          const entry = await store.get(key, { type: 'json' });
          if (!entry) return;
          if (entry.progress) allProgress[key] = entry.progress;
          submissions[key] = entry.submission;
        }));
        return response({ progress: allProgress, submissions });
      }
      const user = users.find(candidate => normalizePin(candidate.pin) === pin);
      if (!pin || !user) return response({ error: 'Ученик не найден' }, 403);
      const originalKey = String(user.pin);
      for (let attempt = 0; attempt < 5; attempt++) {
        stage = 'blob-read';
        const current = await store.getWithMetadata(pin, { type: 'json' });
        const oldProgress = current?.data?.progress ?? object(legacy.progress)[originalKey];
        const oldSubmission = object(current?.data?.submission ?? object(legacy.submissions)[originalKey]);
        const days = mergeDays(object(oldProgress), action === 'save' ? progress : {});
        const submission = {
          ...oldSubmission,
          ...summarize(days),
          name: user.name,
          ts: Date.now(),
          stats: mergeStats(oldSubmission.stats, stats),
        };
        stage = 'blob-write';
        const updated = await store.setJSON(pin, { progress: days, submission },
          current ? { onlyIfMatch: current.etag } : { onlyIfNew: true });
        if (updated.modified) return response({ ok: true });
      }
      return response({ error: 'Данные изменились одновременно. Повторите отправку.' }, 409);
    } catch (error) {
      const status = error?.status ?? error?.statusCode;
      console.error('student-progress', { stage, name: error?.name, status: Number.isInteger(status) ? status : undefined });
      const message = stage === 'legacy-read'
        ? 'Не удалось прочитать список учеников из JSONBin'
        : 'Не удалось '+ (stage === 'blob-write' ? 'записать прогресс в Netlify Blobs' : 'прочитать данные из Netlify Blobs');
      return response({ error: message, stage }, 503);
    }
  };
}

async function readLegacy() {
  const bin = process.env.POWERLIFTING_JSONBIN_ID?.trim() || '6ad3f7d4ffd5d1605374802b';
  if (!/^[a-f0-9]{24}$/i.test(bin ?? '')) throw new Error('Missing JSONBin configuration');
  const res = await fetch('https://api.jsonbin.io/v3/b/' + bin + '/latest', {
    headers: { 'X-Bin-Meta': 'false' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw Object.assign(new Error('Cannot read legacy data'), { status: res.status });
  const data = await res.json();
  return data.record || data;
}

export default createHandler({
  openStore: () => getStore({ name: 'student-progress', consistency: 'strong' }),
  openProgramStore: () => getStore({ name: 'training-program', consistency: 'strong' }),
  readLegacy,
  adminPin: process.env.POWERLIFTING_ADMIN_PIN?.trim(),
});
