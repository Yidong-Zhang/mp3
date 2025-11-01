require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const usersRouter = require('./routes/users');
const tasksRouter  = require('./routes/tasks');

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api/users', usersRouter);
app.use('/api/tasks', tasksRouter);

app.use("/users", usersRouter);
app.use("/tasks", tasksRouter);


app.get('/health', (req, res) => {
  res.status(200).json({ message: 'OK', data: { uptime: process.uptime() } });
});

app.use((err, req, res, next) => {
  if (err?.code === 11000) {
    return res.status(400).json({
      message: 'Duplicate key',
      data: { keys: Object.keys(err.keyPattern || {}) }
    });
  }
  if (err?.name === 'CastError') {
    return res.status(400).json({
      message: 'Invalid id format',
      data: {}
    });
  }
  if (err?.name === 'ValidationError') {
    const fields = Object.values(err.errors || {}).map(e => ({
      field: e.path,
      message: e.kind === 'required' ? 'required' : (e.message || 'invalid')
    }));
    return res.status(400).json({
      message: 'Validation failed',
      data: { fields }
    });
  }
  const status = err.status || 500;
  return res.status(status).json({
    message: status === 500 ? 'Server error' : 'Request error',
    data: {}
  });
});


const MONGODB_URI = process.env.MONGODB_URI;
const PORT = process.env.PORT || 3000;

if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI in environment variables');
  process.exit(1);
}

mongoose.connect(MONGODB_URI, { autoIndex: true })
  .then(() => {
    console.log('MongoDB connected');
    app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err.message);
    process.exit(1);
  });
