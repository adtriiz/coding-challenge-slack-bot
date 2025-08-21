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
          used_at TIMESTAMP,
          slack_ts TEXT
        )
      `);

      this.db.run(`
        CREATE TABLE IF NOT EXISTS submissions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          challenge_id INTEGER,
          user_id TEXT NOT NULL,
          username TEXT NOT NULL,
          submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (challenge_id) REFERENCES challenges(id)
        )
      `);
    });
  }

  async saveChallenge(challenge) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        INSERT INTO challenges (title, description, difficulty, function_stub, example, url, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')
      `, [
        challenge.title,
        challenge.description,
        challenge.difficulty,
        challenge.function_stub,
        challenge.example,
        challenge.url
      ], function(err) {
        if (err) reject(err);
        else resolve(this.lastID);
      });
    });
  }

  async getNextChallenge() {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT * FROM challenges
        WHERE status = 'approved'
        ORDER BY 
          CASE WHEN position IS NULL THEN 9999 ELSE position END ASC,
          created_at ASC
        LIMIT 1
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  async markAsUsed(id, slackTs) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE challenges 
        SET used_at = CURRENT_TIMESTAMP, slack_ts = ?, status = 'used'
        WHERE id = ?
      `, [slackTs, id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getQueueStatus() {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT COUNT(*) as count FROM challenges WHERE status = 'approved'
      `, (err, row) => {
        if (err) reject(err);
        else resolve(row.count);
      });
    });
  }

  async getChallengeQueue() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT id, title, difficulty, status, position 
        FROM challenges 
        WHERE status != 'used'
        ORDER BY 
          CASE WHEN position IS NULL THEN 9999 ELSE position END ASC,
          created_at ASC
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  async approveChallenge(id) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE challenges
        SET status = 'approved'
        WHERE id = ?
      `, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async removeChallenge(id) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        DELETE FROM challenges WHERE id = ?
      `, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async reorderChallenge(id, newPosition) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE challenges
        SET position = ?
        WHERE id = ?
      `, [newPosition, id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async getChallengeById(id) {
    return new Promise((resolve, reject) => {
      this.db.get(`
        SELECT * FROM challenges WHERE id = ?
      `, [id], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
}

module.exports = Database;
