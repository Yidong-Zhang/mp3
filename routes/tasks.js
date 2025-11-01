const express = require('express');
const router = express.Router();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

const Task = require('../models/task');
const User = require('../models/user');
const { buildCollectionQuery, buildIdQuery } = require('../utils/queryParams');

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.toLowerCase() === 'true';
  return !!v;
}
function normStr(v, fallback = '') {
  if (v === undefined || v === null) return fallback;
  return String(v);
}
async function getUserBasic(_id) {
  if (!_id) return null;
  try {
    const u = await User.findById(_id).select({ name: 1, pendingTasks: 1 }).lean(false);
    return u || null;
  } catch {
    return null;
  }
}

router.use((req, _res, next) => {
  if (req.query && req.query.filter && !req.query.select) {
    req.query.select = req.query.filter;
  }
  next();
});

router.get('/', async (req, res, next) => {
  try {
    if (req.query?.filter && !req.query.select) {
      req.query.select = req.query.filter;
      delete req.query.filter;
    }

    const isCount = String(req.query.count).toLowerCase() === 'true';
    if (isCount) {
      let where = {};
      if (req.query.where) {
        try { where = JSON.parse(req.query.where); } catch (_) { where = {}; }
      }
      const n = await Task.countDocuments(where || {});
      return res.status(200).json({ message: 'OK', data: n });
    }

    const q = buildCollectionQuery(Task, req, { defaultLimit: 100 });
    const data = await (q.lean?.().exec?.() ?? q.exec?.() ?? q);
    return res.status(200).json({ message: 'OK', data });
  } catch (e) { next(e); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const doc = await buildIdQuery(Task, req);
    if (!doc) return res.status(404).json({ message: 'Task not found', data: {} });
    res.status(200).json({ message: 'OK', data: doc });
  } catch (e) { next(e); }
});

router.post('/', async (req, res, next) => {
  try {
    const name = normStr(req.body?.name);
    const deadline = req.body?.deadline;
    if (!name || deadline === undefined || deadline === null) {
      return res.status(400).json({ message: 'name and deadline are required', data: {} });
    }

    const description = normStr(req.body?.description, '');
    const completed   = toBool(req.body?.completed);
    const inputAssignedUser = normStr(req.body?.assignedUser, '');
    const inputAssignedUserName = normStr(req.body?.assignedUserName, 'unassigned');

    let au = '';
    let aun = 'unassigned';
    let assignee = null;
    if (inputAssignedUser) {
      assignee = await getUserBasic(inputAssignedUser);
      if (assignee) {
        au = assignee._id.toString();
        aun = inputAssignedUserName || assignee.name || 'unassigned';
      }
    }

    const task = await Task.create({
      name, description, deadline,
      completed,
      assignedUser: au,
      assignedUserName: aun
    });

    if (assignee && !completed) {
      await User.updateOne(
        { _id: assignee._id },
        { $addToSet: { pendingTasks: task._id.toString() } }
      );
    }

    res.status(201).json({
      message: 'Task created',
      data: {
        _id: task._id.toString(),
        name: task.name,
        description: task.description,
        deadline: task.deadline,
        completed: task.completed,
        assignedUser: task.assignedUser,
        assignedUserName: task.assignedUserName,
        dateCreated: task.dateCreated
      }
    });
  } catch (e) { next(e); }
});


router.put('/:id', async (req, res, next) => {
  try {
    const id = req.params.id;

    const oldTask = await Task.findById(id).lean();
    if (!oldTask) return res.status(404).json({ message: 'Task not found', data: {} });


    const name = normStr(req.body?.name);
    const deadline = req.body?.deadline;
    if (!name || deadline === undefined || deadline === null) {
      return res.status(400).json({ message: 'name and deadline are required', data: {} });
    }

  
    const description = normStr(req.body?.description, '');
    const completed   = toBool(req.body?.completed);     
    let   nextAU      = normStr(req.body?.assignedUser, '');        
    let   nextAUN     = normStr(req.body?.assignedUserName, 'unassigned');

    let assigneeDoc = null;
    if (nextAU) {
      assigneeDoc = await getUserBasic(nextAU);
      if (!assigneeDoc) {
        nextAU = '';
      }
    }
    if (nextAU) {
      if (!req.body?.assignedUserName || nextAUN === 'unassigned') {
        nextAUN = assigneeDoc?.name || 'unassigned';
      }
    } else {
      nextAUN = 'unassigned';
    }
    const prevAU = oldTask.assignedUser ? String(oldTask.assignedUser) : '';
    const prevCompleted = !!oldTask.completed;
    const nextCompleted = !!completed;

    const toSet = {
      name,
      description,
      deadline,
      completed: nextCompleted,
      assignedUser: nextAU,
      assignedUserName: nextAUN,
      dateCreated: oldTask.dateCreated
    };

    const updated = await Task.findByIdAndUpdate(
      id,
      { $set: toSet },
      { new: true, runValidators: true }
    );

    const ops = [];
    if (prevAU && (prevAU !== toSet.assignedUser || (!prevCompleted && nextCompleted))) {
      ops.push(User.updateOne(
        { _id: prevAU },
        { $pull: { pendingTasks: updated._id.toString() } }
      ));
    }

    if (toSet.assignedUser && !nextCompleted) {
      ops.push(User.updateOne(
        { _id: toSet.assignedUser },
        { $addToSet: { pendingTasks: updated._id.toString() } }
      ));
    }

    await Promise.all(ops);

    return res.status(200).json({
      message: 'Task updated',
      data: {
        _id: updated._id.toString(),
        name: updated.name,
        description: updated.description,
        deadline: updated.deadline,
        completed: updated.completed,
        assignedUser: updated.assignedUser,
        assignedUserName: updated.assignedUserName,
        dateCreated: updated.dateCreated
      }
    });
  } catch (e) { next(e); }
});


router.delete('/:id', async (req, res, next) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) return res.status(404).json({ message: 'Task not found', data: {} });

    if (task.assignedUser) {
      await User.updateOne(
        { _id: task.assignedUser },
        { $pull: { pendingTasks: task._id.toString() } }
      );
    }

    await Task.deleteOne({ _id: task._id });
    return res.status(200).json({ message: 'Task deleted', data: {} });
  } catch (e) { next(e); }
});

router.delete('/', async (req, res, next) => {
  try {
    await User.updateMany({}, { $set: { pendingTasks: [] } });
    const result = await Task.deleteMany({});
    res.status(200).json({ message: 'Tasks cleared', data: { deletedCount: result.deletedCount } });
  } catch (e) { next(e); }
});

module.exports = router;
