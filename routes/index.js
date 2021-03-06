const router = require('express-promise-router')();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const PRIVATE_KEY = process.env.PRIVATE_KEY.replace(/\\n/g, '\n');
const PUBLIC_KEY = process.env.PUBLIC_KEY.replace(/\\n/g, '\n');
const VALID_ROLES = ['admins', 'users', 'employees', 'managers'];
const SELECT_COLS = ['username', 'password', 'salt', 'locked', 'contact', 'loginattempts', 'firstname', 'lastname'].join(', ');
const SALT_ITERATIONS = 1000;

function jwtsign(role, username) {
  return jwt.sign({
    role: role,
    user: username,
  },
  PRIVATE_KEY,
  {
    algorithm: 'RS256',
    expiresIn: '10y',
    issuer: 'scrumlords',
  });
}

function jwtdecode(token) {
  return jwt.verify(token, PUBLIC_KEY);
}

function hashPassword(password) {
    var salt = crypto.randomBytes(128).toString('base64');
    var hash = crypto.pbkdf2Sync(password, salt, SALT_ITERATIONS, 64, 'sha512');

    return {
        salt: salt,
        hash: hash.toString('hex'),
    };
}

function isPasswordCorrect(savedHash, savedSalt, passwordAttempt) {
    return savedHash == crypto.pbkdf2Sync(passwordAttempt, savedSalt, SALT_ITERATIONS, 64, 'sha512').toString('hex');
}

const { Pool, Client } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: true,
})

/* GET home page. */
router.get('/', async (req, res, next) => {
  res.render('index');
});

/* POST login */
router.post('/login', async (req, res, next) => {
  if (!req.body.username) {
    res.status(400).json({error: 1101, msg: 'Username not provided'});
    return;
  }
  if (!req.body.password) {
    res.status(400).json({error: 1102, msg: 'Password not provided'});
    return;
  }

  var user = await pool.query('SELECT \'admins\' AS tablename, ' + SELECT_COLS + ' FROM admins WHERE username = $1 ' +
    'UNION SELECT \'users\' AS tablename, ' + SELECT_COLS + ' FROM users WHERE username = $1 ' +
    'UNION SELECT \'employees\' AS tablename, ' + SELECT_COLS + ' FROM employees WHERE username = $1 ' +
    'UNION SELECT \'managers\' AS tablename, ' + SELECT_COLS + ' FROM managers WHERE username = $1',
    [req.body.username]);

  if (user.rows.length == 0) {
    res.status(400).json({error: 1100, msg: 'Username not found'});
    return;
  }

  user = user.rows[0];

  if (user.locked) {
    res.status(400).json({error: 1103, msg: 'Account is locked please ask an admin to let you in'});
    return;
  }

  if (isPasswordCorrect(user.password, user.salt, req.body.password)) {
    await pool.query('UPDATE ' + user.tablename + ' SET loginattempts=$1 WHERE username=$2', [0, user.username]);
    res.status(200).json({error:0, msg: "Success!", role: user.tablename, jwt: jwtsign(user.tablename, user.username), firstname: user.firstname, lastname: user.lastname});
    return;
  } else {
    await pool.query('UPDATE ' + user.tablename + ' SET loginattempts=$1, locked=$2 WHERE username=$3', [user.loginattempts + 1, (user.loginattempts + 1) >= 3, user.username]);
    res.status(400).json({error: 1104, msg: (user.loginattempts + 1) + ' times entering an incorrect password'});
    return;
  }
});

/* POST registration */
router.post('/registration', async (req, res, next) => {
  // Check if input valid
  if (VALID_ROLES.indexOf(req.body.role) == -1) {
    res.status(400).json({error: 1000, msg: 'Provide a valid role'});
    return;
  }
  if (!req.body.username) {
    res.status(400).json({error: 1001, msg: 'Username not provided'});
    return;
  }
  if (!req.body.password) {
    res.status(400).json({error: 1002, msg: 'Password not provided'});
    return;
  }

  // Check if Username taken
  var taken = await pool.query('SELECT ' + SELECT_COLS + ' FROM admins WHERE username = $1 ' +
    'UNION SELECT ' + SELECT_COLS + ' FROM users WHERE username = $1 ' +
    'UNION SELECT ' + SELECT_COLS + ' FROM employees WHERE username = $1 ' +
    'UNION SELECT ' + SELECT_COLS + ' FROM managers WHERE username = $1',
    [req.body.username]);
  if (taken.rows.length > 0) {
    res.status(400).json({error: 1003, msg: 'Username taken please choose another'});
    return;
  }

  var pass = hashPassword(req.body.password);

  var reg = await pool.query('INSERT INTO ' + req.body.role +
    ' (username, password, salt, contact, firstname, lastname)' +
    ' VALUES ($1, $2, $3, $4, $5, $6)',
    [req.body.username, pass.hash, pass.salt, req.body.contact,
    req.body.firstname, req.body.lastname]);

  res.status(200).json({error:0, msg: 'We gucci'});
});

router.get('/locations', async (req, res, next) => {
  var locs = await pool.query('SELECT * FROM locations');
  res.status(200).json({error:0, msg: 'Alllllllll gooooooodddd', locations: locs.rows});
});

module.exports = router;
