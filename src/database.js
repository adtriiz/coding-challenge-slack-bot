const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    const dbPath = path.join(__dirname, '..', 'challenges.db');
    this.db = new sqlite3.Database(dbPath);
    this.init();
  }

  init() {
    this.db.serialize(() => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS challenges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          difficulty TEXT NOT NULL,
          function_stub TEXT NOT NULL,
          example TEXT NOT NULL,
          url TEXT,
          status TEXT DEFAULT 'pending',
          position INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          scheduled_post_at INTEGER, -- epoch seconds (Slack post_at)
          scheduled_message_id TEXT, -- Slack scheduled message id
          slack_ts TEXT -- optional: real posted ts (if we later confirm delivery)
      `);
    });
  }

  saveChallenge(ch) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO challenges (title, description, difficulty, function_stub, example, url, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
        [ch.title, ch.description, ch.difficulty, ch.function_stub, ch.example, ch.url],
        function (err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  getChallengeById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM challenges WHERE id = ?`, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  getQueue(includeUsed = false) {
    return new Promise((resolve, reject) => {
      this.db.all(
        `SELECT id, title, difficulty, status, position, scheduled_post_at, scheduled_message_id
         FROM challenges
         WHERE ${includeUsed ? '1=1' : "status != 'used'"}
         ORDER BY CASE WHEN position IS NULL THEN 9999 ELSE position END ASC, created_at ASC`,
        (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        }
      );
    });
  }

  approveChallenge(id) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE challenges SET status = 'approved' WHERE id = ?`,
        [id],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  markScheduled(id, postAtEpoch, scheduledMessageId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE challenges
         SET status = 'scheduled', scheduled_post_at = ?, scheduled_message_id = ?, position = NULL
         WHERE id = ?`,
        [postAtEpoch, scheduledMessageId, id],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  reorderChallenge(id, position) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE challenges SET position = ? WHERE id = ?`,
        [position, id],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  removeChallenge(id) {
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM challenges WHERE id = ?`, [id], (err) => (err ? reject(err) : resolve()));
    });
  }
}

module.exports = Database;