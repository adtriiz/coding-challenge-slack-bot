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
      // Main queue table: pending, approved, scheduled
      this.db.run(`
        CREATE TABLE IF NOT EXISTS challenges (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          difficulty TEXT NOT NULL,
          function_stub TEXT NOT NULL,
          example TEXT NOT NULL,
          url TEXT,
          status TEXT CHECK(status IN ('pending', 'approved', 'scheduled')) DEFAULT 'pending',
          position INTEGER, -- for pending only, contiguous
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          scheduled_post_at INTEGER, -- epoch seconds (Slack post_at)
          scheduled_message_id TEXT, -- Slack scheduled message id
          slack_ts TEXT -- optional: real posted ts (if we later confirm delivery)
        )
      `);

      // Archive table for published challenges
      this.db.run(`
        CREATE TABLE IF NOT EXISTS published_challenges (
          id INTEGER PRIMARY KEY,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          difficulty TEXT NOT NULL,
          function_stub TEXT NOT NULL,
          example TEXT NOT NULL,
          url TEXT,
          status TEXT,
          position INTEGER,
          created_at TIMESTAMP,
          scheduled_post_at INTEGER,
          scheduled_message_id TEXT,
          slack_ts TEXT,
          published_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    });
  }

  getChallengeByScheduledMessageId(scheduledMessageId) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT * FROM challenges WHERE scheduled_message_id = ?`, [scheduledMessageId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  archiveChallenge(id) {
    return new Promise((resolve, reject) => {
      // Copy challenge to published_challenges and remove from challenges
      this.db.get(`SELECT * FROM challenges WHERE id = ?`, [id], (err, row) => {
        if (err) return reject(err);
        if (!row) return resolve(); // nothing to archive
        this.db.run(`
          INSERT INTO published_challenges (
            id, title, description, difficulty, function_stub, example, url, status, position, created_at, scheduled_post_at, scheduled_message_id, slack_ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [row.id, row.title, row.description, row.difficulty, row.function_stub, row.example, row.url, row.status, row.position, row.created_at, row.scheduled_post_at, row.scheduled_message_id, row.slack_ts], (err2) => {
          if (err2) return reject(err2);
          this.db.run(`DELETE FROM challenges WHERE id = ?`, [id], (err3) => {
            if (err3) return reject(err3);
            this.recalculatePositions().then(resolve).catch(reject);
          });
        });
      });
    });
  }
  unscheduleChallenge(id) {
    return new Promise((resolve, reject) => {
      this.db.run(`
        UPDATE challenges
        SET status = 'pending', scheduled_post_at = NULL, scheduled_message_id = NULL
        WHERE id = ?
      `, [id], (err) => {
        if (err) return reject(err);
        this.recalculatePositions().then(resolve).catch(reject);
      });
    });
  }

  saveChallenge(ch) {
    return new Promise((resolve, reject) => {
      // Find max position among pending
      this.db.get(`SELECT MAX(position) as maxPos FROM challenges WHERE status = 'pending'`, (err, row) => {
        if (err) return reject(err);
        const pos = (row && row.maxPos) ? row.maxPos + 1 : 1;
        this.db.run(
          `INSERT INTO challenges (title, description, difficulty, function_stub, example, url, status, position)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
          [ch.title, ch.description, ch.difficulty, ch.function_stub, ch.example, ch.url, pos],
          function (err2) {
            if (err2) reject(err2);
            else resolve(this.lastID);
          }
        );
      });
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
      // Set challenge to approved, set scheduled_post_at/message_id
      this.db.run(`
        UPDATE challenges
        SET status = 'approved', scheduled_post_at = NULL, scheduled_message_id = NULL
        WHERE id = ?
      `, [id], (err) => {
        if (err) return reject(err);
        this.recalculatePositions().then(resolve).catch(reject);
      });
    });
  }

  markScheduled(id, postAtEpoch, scheduledMessageId) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE challenges
         SET status = 'approved', scheduled_post_at = ?, scheduled_message_id = ?
         WHERE id = ?`,
        [postAtEpoch, scheduledMessageId, id],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  reorderChallenge(id, newPosition) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT position FROM challenges WHERE id = ?`, [id], (err, row) => {
        if (err) return reject(err);
        const oldPosition = row.position;

        if (oldPosition == null) {
          // If the challenge didn't have a position, just insert it and shift down
          this.db.run(
            `UPDATE challenges SET position = position + 1 WHERE position >= ? AND position IS NOT NULL`,
            [newPosition],
            (err2) => {
              if (err2) return reject(err2);
              this.db.run(
                `UPDATE challenges SET position = ? WHERE id = ?`,
                [newPosition, id],
                (err3) => (err3 ? reject(err3) : resolve())
              );
            }
          );
        } else if (newPosition < oldPosition) {
          // Moving up: shift down those at or above newPosition and below oldPosition
          this.db.run(
            `UPDATE challenges SET position = position + 1
             WHERE position >= ? AND position < ? AND id != ? AND position IS NOT NULL`,
            [newPosition, oldPosition, id],
            (err2) => {
              if (err2) return reject(err2);
              this.db.run(
                `UPDATE challenges SET position = ? WHERE id = ?`,
                [newPosition, id],
                (err3) => (err3 ? reject(err3) : resolve())
              );
            }
          );
        } else if (newPosition > oldPosition) {
          // Moving down: shift up those between oldPosition and newPosition
          this.db.run(
            `UPDATE challenges SET position = position - 1
             WHERE position > ? AND position <= ? AND id != ? AND position IS NOT NULL`,
            [oldPosition, newPosition, id],
            (err2) => {
              if (err2) return reject(err2);
              this.db.run(
                `UPDATE challenges SET position = ? WHERE id = ?`,
                [newPosition, id],
                (err3) => (err3 ? reject(err3) : resolve())
              );
            }
          );
        } else {
          resolve();
        }
      });
    });
  }

  removeChallenge(id) {
    return new Promise((resolve, reject) => {
      this.db.run(`DELETE FROM challenges WHERE id = ?`, [id], (err) => {
        if (err) return reject(err);
        this.recalculatePositions().then(resolve).catch(reject);
      });
    });
  }

  async recalculatePositions() {
    return new Promise((resolve, reject) => {
      // Get all approved/scheduled challenges ordered by scheduled_post_at
      this.db.all(`SELECT id FROM challenges WHERE status IN ('approved', 'scheduled') ORDER BY scheduled_post_at ASC, id ASC`, [], (err, approvedRows) => {
        if (err) return reject(err);
        // Get all pending challenges ordered by manual position
        this.db.all(`SELECT id FROM challenges WHERE status = 'pending' ORDER BY position ASC, id ASC`, [], (err2, pendingRows) => {
          if (err2) return reject(err2);
          let updates = [];
          let pos = 1;
          for (const row of approvedRows) {
            updates.push({ id: row.id, position: pos++ });
          }
          for (const row of pendingRows) {
            updates.push({ id: row.id, position: pos++ });
          }
          let remaining = updates.length;
          if (remaining === 0) return resolve();
          for (const u of updates) {
            this.db.run(`UPDATE challenges SET position = ? WHERE id = ?`, [u.position, u.id], (err3) => {
              if (err3) return reject(err3);
              remaining--;
              if (remaining === 0) resolve();
            });
          }
        });
      });
    });
  }

}

module.exports = Database;