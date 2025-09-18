// src/database.js
const { Pool } = require('pg');

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL, // Supabase/Postgres connection string
      ssl: { rejectUnauthorized: false },
      max: 5, // Limit to 5 connections
      idleTimeoutMillis: 30000 // 30 seconds
    });
  }

  async getChallengeByScheduledMessageId(scheduledMessageId) {
    const res = await this.pool.query(
      `SELECT * FROM challenges WHERE scheduled_message_id = $1`,
      [scheduledMessageId]
    );
    return res.rows[0];
  }

  async archiveChallenge(id) {
    const res = await this.pool.query(
      `SELECT * FROM challenges WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) return;

    const row = res.rows[0];
    await this.pool.query(
      `INSERT INTO published_challenges (
        id, title, description, difficulty, function_stub, example, url, status, position, created_at,
        scheduled_post_at, scheduled_message_id, slack_ts
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO NOTHING`,
      [
        row.id, row.title, row.description, row.difficulty, row.function_stub,
        row.example, row.url, row.status, row.position, row.created_at,
        row.scheduled_post_at, row.scheduled_message_id, row.slack_ts
      ]
    );

    await this.removeChallenge(id);
  }

  async unscheduleChallenge(id) {
    await this.pool.query(
      `UPDATE challenges
       SET status = 'pending', scheduled_post_at = NULL, scheduled_message_id = NULL
       WHERE id = $1`,
      [id]
    );
    await this.recalculatePositions();
  }

  async saveChallenge(ch) {
    const res = await this.pool.query(
      `INSERT INTO challenges (title, description, difficulty, function_stub, example, url, status, position)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending',
         COALESCE((SELECT MAX(position) FROM challenges WHERE status = 'pending'), 0) + 1)
       RETURNING id`,
      [ch.title, ch.description, ch.difficulty, ch.function_stub, ch.example, ch.url]
    );
    return res.rows[0].id;
  }

  async getChallengeById(id) {
    const res = await this.pool.query(`SELECT * FROM challenges WHERE id = $1`, [id]);
    return res.rows[0];
  }

  async getQueue(includeUsed = false) {
    const condition = includeUsed ? '1=1' : "status != 'used'";
    const res = await this.pool.query(
      `SELECT id, title, difficulty, status, position, scheduled_post_at, scheduled_message_id
       FROM challenges
       WHERE ${condition}
       ORDER BY COALESCE(position, 9999), created_at ASC`
    );
    return res.rows;
  }

  async approveChallenge(id) {
    await this.pool.query(
      `UPDATE challenges
       SET status = 'approved', scheduled_post_at = NULL, scheduled_message_id = NULL
       WHERE id = $1`,
      [id]
    );
    await this.recalculatePositions();
  }

  async markScheduled(id, postAtEpoch, scheduledMessageId) {
    await this.pool.query(
      `UPDATE challenges
       SET status = 'approved', scheduled_post_at = $1, scheduled_message_id = $2
       WHERE id = $3`,
      [postAtEpoch, scheduledMessageId, id]
    );
  }

  async reorderChallenge(id, newPosition) {
    const res = await this.pool.query(
      `SELECT position FROM challenges WHERE id = $1`,
      [id]
    );
    if (res.rows.length === 0) return;
    const oldPosition = res.rows[0].position;

    if (oldPosition === null) {
      // If challenge didn’t have a position, insert it and shift down
      await this.pool.query(
        `UPDATE challenges SET position = position + 1 WHERE position >= $1 AND position IS NOT NULL`,
        [newPosition]
      );
      await this.pool.query(`UPDATE challenges SET position = $1 WHERE id = $2`, [
        newPosition,
        id,
      ]);
    } else if (newPosition < oldPosition) {
      // Moving up
      await this.pool.query(
        `UPDATE challenges SET position = position + 1
         WHERE position >= $1 AND position < $2 AND id != $3 AND position IS NOT NULL`,
        [newPosition, oldPosition, id]
      );
      await this.pool.query(`UPDATE challenges SET position = $1 WHERE id = $2`, [
        newPosition,
        id,
      ]);
    } else if (newPosition > oldPosition) {
      // Moving down
      await this.pool.query(
        `UPDATE challenges SET position = position - 1
         WHERE position > $1 AND position <= $2 AND id != $3 AND position IS NOT NULL`,
        [oldPosition, newPosition, id]
      );
      await this.pool.query(`UPDATE challenges SET position = $1 WHERE id = $2`, [
        newPosition,
        id,
      ]);
    }
  }

  async removeChallenge(id) {
    await this.pool.query(`DELETE FROM challenges WHERE id = $1`, [id]);
    await this.recalculatePositions();
  }

  async recalculatePositions() {
    // Get approved/scheduled challenges ordered by scheduled_post_at
    const approved = await this.pool.query(
      `SELECT id FROM challenges 
       WHERE status IN ('approved', 'scheduled') 
       ORDER BY scheduled_post_at ASC, id ASC`
    );

    // Get pending challenges ordered by manual position
    const pending = await this.pool.query(
      `SELECT id FROM challenges 
       WHERE status = 'pending' 
       ORDER BY position ASC, id ASC`
    );

    let pos = 1;
    const updates = [];

    for (const row of approved.rows) {
      updates.push({ id: row.id, position: pos++ });
    }
    for (const row of pending.rows) {
      updates.push({ id: row.id, position: pos++ });
    }

    for (const u of updates) {
      await this.pool.query(`UPDATE challenges SET position = $1 WHERE id = $2`, [
        u.position,
        u.id,
      ]);
    }
  }
}

module.exports = Database;
