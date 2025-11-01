const express = require('express');
const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');
const { buildIdQuery } = require('../utils/queryParams');

function normalizePendingTasks(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String);
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch (_) {}
    return input.split(',').map(s => s.trim()).filter(Boolean).map(String);
  }
  return [];
}

function shapeUserData(u) {
  return {
    _id: u._id.toString(),
    name: u.name,
    email: u.email,
    pendingTasks: (u.pendingTasks || []).map(String),
    dateCreated: u.dateCreated
  };
}

function safeJSONParse(s, fallback) {
  if (s == null) return fallback;
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

function castIdInWhere(where) {
  if (!where || typeof where !== 'object') return where;
  const w = { ...where };
  if (typeof w._id === 'string' && /^[a-fA-F0-9]{24}$/.test(w._id)) {
    w._id = new mongoose.Types.ObjectId(w._id);
  }
  return w;
}


router.use((req, _res, next) => {
  if (req.query && req.query.filter && !req.query.select) {
    req.query.select = req.query.filter;   
  }
  next();
});

router.get('/', async (req, res, next) => {
  try {
    const where  = castIdInWhere(safeJSONParse(req.query.where, {}));
    const sort   = safeJSONParse(req.query.sort, undefined);
    const select = safeJSONParse(req.query.select, undefined);
    const skip   = req.query.skip != null ? Number(req.query.skip) : undefined;
    const limit  = req.query.limit != null ? Number(req.query.limit) : undefined;
    const count  = String(req.query.count).toLowerCase() === 'true';

    if (count) {
      const n = await User.countDocuments(where || {});
      return res.status(200).json({ message: 'OK', data: n });
    }

    let q = User.find(where || {});
    if (select) q = q.select(select);
    if (sort) q = q.sort(sort);
    if (skip != null && !Number.isNaN(skip)) q = q.skip(skip);
    if (limit != null && !Number.isNaN(limit)) q = q.limit(limit);

    const data = await q.lean();
    res.status(200).json({ message: 'OK', data });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const doc = await buildIdQuery(User, req);
    if (!doc) return res.status(404).json({ message: 'User not found', data: {} });
    res.status(200).json({ message: 'OK', data: doc });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    let { name, email, pendingTasks } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required', data: {} });
    }

    pendingTasks = normalizePendingTasks(pendingTasks);
    const user = await User.create({ name, email, pendingTasks });

    if (pendingTasks.length) {
      await Task.updateMany(
        { _id: { $in: pendingTasks } },
        { $set: { assignedUser: user._id.toString(), assignedUserName: user.name, completed: false } }
      );
    }

    res.status(201).json({ message: 'User created', data: shapeUserData(user) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(400).json({ message: 'email must be unique', data: {} });
    }
    next(e);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    let { name, email, pendingTasks } = req.body || {};
    if (!name || !email) {
      return res.status(400).json({ message: 'name and email are required', data: {} });
    }

    pendingTasks = normalizePendingTasks(pendingTasks);
    const existing = await User.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: 'User not found', data: {} });

    const prev = new Set((existing.pendingTasks || []).map(String));
    const nextSet = new Set(pendingTasks.map(String));
    const toAssign = [...nextSet].filter(x => !prev.has(x));
    const toUnassign = [...prev].filter(x => !nextSet.has(x));

    existing.name = name;
    existing.email = email;
    existing.pendingTasks = pendingTasks;
    const user = await existing.save({ validateModifiedOnly: true });
    const uid = user._id.toString();

    const ops = [];
    if (toAssign.length) {
      ops.push(Task.updateMany(
        { _id: { $in: toAssign } },
        { $set: { assignedUser: uid, assignedUserName: user.name, completed: false } }
      ));
    }
    if (toUnassign.length) {
      ops.push(Task.updateMany(
        { _id: { $in: toUnassign } },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
      ));
    }
    await Promise.all(ops);

    res.status(200).json({ message: 'User updated', data: shapeUserData(user) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(400).json({ message: 'email must be unique', data: {} });
    }
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await Task.updateMany(
      { assignedUser: req.params.id },
      { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
    );
    const del = await User.findByIdAndDelete(req.params.id);
    if (!del) return res.status(404).json({ message: 'User not found', data: {} });
    return res.status(200).json({ message: 'User deleted', data: {} }); 
  } catch (e) { next(e); }
});

module.exports = router;
