module.exports = function (app, router) {
  const usersRouter = require('./users');
  const tasksRouter = require('./tasks');

  router.formatOk = (data, msg = 'OK') => ({ message: msg, data });
  router.formatErr = (msg, data = null) => ({ message: msg, data });

  app.use('/api/users', usersRouter);
  app.use('/api/tasks', tasksRouter);

  const homeRoute = router.route('/');
  homeRoute.get((req, res) => {
    res.json({ message: 'Welcome to Llama.io API', data: null });
  });

  app.use('/api', router);
};
