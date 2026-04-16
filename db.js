// db.js — Azure SQL connection pool using mssql
require('dotenv').config();
const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  port: parseInt(process.env.DB_PORT) || 1433,
  options: {
    encrypt: true,           // Required for Azure SQL
    trustServerCertificate: false,
    enableArithAbort: true,
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

let pool;

async function getPool() {
  if (!pool) {
    console.log(config);
    pool = await sql.connect(config);
    console.log('✅ Connected to Azure SQL Database');
  }
  return pool;
}

// ─── Create tables if they don't exist ────────────────────────────────
async function initDB() {
  const db = await getPool();

  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='students' AND xtype='U')
    CREATE TABLE students (
      id           INT IDENTITY(1,1) PRIMARY KEY,
      first_name   NVARCHAR(100)  NOT NULL,
      last_name    NVARCHAR(100)  NOT NULL,
      email        NVARCHAR(255)  NOT NULL UNIQUE,
      password     NVARCHAR(255)  NOT NULL,
      phone        NVARCHAR(20),
      program      NVARCHAR(200),
      dob          DATE,
      created_at   DATETIME2      DEFAULT GETDATE(),
      is_active    BIT            DEFAULT 1
    );
  `);

  await db.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='contact_submissions' AND xtype='U')
    CREATE TABLE contact_submissions (
      id         INT IDENTITY(1,1) PRIMARY KEY,
      name       NVARCHAR(200) NOT NULL,
      email      NVARCHAR(255) NOT NULL,
      subject    NVARCHAR(300),
      message    NVARCHAR(MAX) NOT NULL,
      created_at DATETIME2     DEFAULT GETDATE()
    );
  `);

  console.log('✅ Database tables verified/created');
}

module.exports = { getPool, initDB, sql };
