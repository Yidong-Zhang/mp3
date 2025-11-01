const mongoose = require('mongoose');
function parseJSON(s, name) {
  if (s === undefined) return undefined;
  try { return JSON.parse(s); }
  catch {
    const err = new Error(`"${name}" is not valid JSON`);
    err.status = 400;
    throw err;
  }
}

function toBool(v) {
  if (v === undefined) return false;
  if (typeof v === 'boolean') return v;
  return String(v).toLowerCase() === 'true';
}

function toInt(v, fallback) {
  if (v === undefined || v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}

function is24Hex(str) {
  return typeof str === 'string' && /^[a-fA-F0-9]{24}$/.test(str);
}

function castIdInWhere(where) {
  if (!where || typeof where !== 'object') return where;
  const out = { ...where };

  if (is24Hex(out._id)) {
    out._id = new mongoose.Types.ObjectId(out._id);
  }

  if (out._id && typeof out._id === 'object') {
    const wId = { ...out._id };
    if (Array.isArray(wId.$in)) {
      wId.$in = wId.$in.map(v => is24Hex(v) ? new mongoose.Types.ObjectId(v) : v);
    }
    if (Array.isArray(wId.$nin)) {
      wId.$nin = wId.$nin.map(v => is24Hex(v) ? new mongoose.Types.ObjectId(v) : v);
    }
    if (is24Hex(wId.$eq)) {
      wId.$eq = new mongoose.Types.ObjectId(wId.$eq);
    }
    out._id = wId;
  }

  return out;
}

function buildCollectionQuery(model, req, { defaultLimit = null } = {}) {
  const where  = castIdInWhere(parseJSON(req.query.where,  'where')  || {});
  const sort   = parseJSON(req.query.sort,   'sort');
  const select = parseJSON(req.query.select, 'select');
  const skip   = toInt(req.query.skip, 0);
  const count  = toBool(req.query.count);

  const limit = req.query.limit !== undefined
    ? toInt(req.query.limit, defaultLimit ?? 0)
    : (defaultLimit ?? 0);

  if (count) {
    return { type: 'count', exec: () => model.countDocuments(where).exec() };
  }

  let q = model.find(where);
  if (select) q = q.select(select);
  if (sort)   q = q.sort(sort);
  if (skip)   q = q.skip(skip);
  if (defaultLimit !== null) q = q.limit(limit);
  q = q.lean();

  return { type: 'find', exec: () => q.exec() };
}

function buildIdQuery(model, req) {
  const select = parseJSON(req.query.select, 'select');
  let q = model.findById(req.params.id);
  if (select) q = q.select(select);
  return q.lean().exec();
}

module.exports = { buildCollectionQuery, buildIdQuery };
