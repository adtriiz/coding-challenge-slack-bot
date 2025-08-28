const { App } = require('@slack/bolt');
const { DateTime } = require('luxon');
const Database = require('./database');
const AIClient = require('./ai-client');

const TZ = 'Africa/Nairobi'; // EAT (UTC+3)

class SlackBot {
  constructor() {
    this.app = new App({
      token: process.env.SLACK_BOT_TOKEN,
      signingSecret: process.env.SLACK_SIGNING_SECRET
      // Default Bolt receiver exposes POST /slack/events for commands/events
    });
    this.db = new Database();
    this.ai = new AIClient();
    this.setupCommands();
  }

  setupCommands() {
    // Generate → pending
    this.app.command('/generate', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const difficulty = (command.text || 'medium').trim().toLowerCase();
      await respond(`🎲 Generating a random "${difficulty}" challenge...`);
      try {
        const ch = await this.ai.generateChallenge(difficulty);
        const id = await this.db.saveChallenge(ch);
        await respond(`✅ Added *${ch.title}* (${ch.difficulty}) with ID \`${id}\`. Use \`/approve ${id}\` to schedule.`);
      } catch (e) {
        console.error('generate error', e);
        await respond('❌ Failed to generate challenge.');
      }
    });

    // Approve & schedule: /approve <id> [YYYY-MM-DD HH:mm]
    this.app.command('/approve', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const args = command.text.trim();
      if (!args) return respond('⚠️ Usage: `/approve <id> [YYYY-MM-DD HH:mm]` (time in EAT)');

      const [idStr, ...rest] = args.split(/\s+/);
      const id = parseInt(idStr, 10);
      if (Number.isNaN(id)) return respond('⚠️ First argument must be a numeric ID.');

      try {
        await this.db.approveChallenge(id);
        const ch = await this.db.getChallengeById(id);
        if (!ch) return respond(`❓ Challenge ${id} not found.`);

        const whenText = rest.join(' ').trim();
        const postAt = whenText ? this.parseToEpoch(whenText) : this.nextTuesdayNine();
        if (!postAt || postAt <= Math.floor(Date.now()/1000)) {
          return respond('⚠️ Invalid or past datetime. Use `YYYY-MM-DD HH:mm` (EAT).');
        }

        const { scheduled_message_id } = await this.scheduleChallenge(ch, postAt);
        await respond(`📅 Scheduled *${ch.title}* for <t:${postAt}:F> EAT. (scheduled_message_id: \`${scheduled_message_id}\`)`);
      } catch (e) {
        console.error('approve error', e);
        await respond('❌ Failed to approve/schedule challenge.');
      }
    });

    // Autoschedule next N Tuesdays at 09:00 EAT
    this.app.command('/autoschedule', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const count = Math.max(1, parseInt(command.text.trim(), 10) || 4);
      try {
        const queue = await this.db.getQueue(false);
        const approved = queue.filter(q => q.status === 'approved');
        if (approved.length === 0) return respond('📭 No approved challenges to schedule.');

        const targets = this.nextNTuesdaysNine(count);
        let i = 0, scheduledCount = 0;
        for (const item of approved) {
          if (i >= targets.length) break;
          const postAt = targets[i++];
          const full = await this.db.getChallengeById(item.id);
          const { scheduled_message_id } = await this.scheduleChallenge(full, postAt);
          scheduledCount++;
          await respond(`✅ Scheduled *${full.title}* for <t:${postAt}:F> EAT (id: ${full.id}, smid: \`${scheduled_message_id}\`).`);
        }
        if (scheduledCount === 0) {
          await respond('ℹ️ No items scheduled — not enough upcoming slots or empty queue.');
        }
      } catch (e) {
        console.error('autoschedule error', e);
        await respond('❌ Failed to autoschedule.');
      }
    });

    // Queue
    this.app.command('/queue', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      try {
        const list = await this.db.getQueue();
        if (list.length === 0) return respond('📭 The challenge queue is empty.');
        const lines = list.map(c =>
          `• *${c.id}: ${c.title}* (${c.difficulty}) – _${c.status}_ – pos: ${c.position ?? '—'}${c.scheduled_post_at ? ` – <t:${c.scheduled_post_at}:F>` : ''}${c.scheduled_message_id ? ` – smid: \`${c.scheduled_message_id}\`` : ''}`
        );
        await respond(`📋 *Challenge Queue:*\n${lines.join('\n')}`);
      } catch (e) {
        console.error('queue error', e);
        await respond('❌ Failed to fetch queue.');
      }
    });

    // Reorder
    this.app.command('/reorder', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const [idStr, posStr] = (command.text || '').trim().split(/\s+/);
      const id = parseInt(idStr, 10);
      const pos = parseInt(posStr, 10);
      if (Number.isNaN(id) || Number.isNaN(pos)) return respond('⚠️ Usage: `/reorder <id> <position>`');
      try {
        await this.db.reorderChallenge(id, pos);
        await respond(`✅ Challenge ${id} moved to position ${pos}.`);
      } catch (e) {
        console.error('reorder error', e);
        await respond('❌ Failed to reorder challenge.');
      }
    });

    // Delete
    this.app.command('/delete', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const id = parseInt((command.text || '').trim(), 10);
      if (Number.isNaN(id)) return respond('⚠️ Usage: `/delete <id>`');
      try {
        await this.db.removeChallenge(id);
        await respond(`🗑️ Challenge ${id} removed.`);
      } catch (e) {
        console.error('delete error', e);
        await respond('❌ Failed to delete challenge.');
      }
    });

    // Preview
    this.app.command('/preview', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const id = parseInt((command.text || '').trim(), 10);
      if (Number.isNaN(id)) return respond('⚠️ Usage: `/preview <id>`');
      try {
        const ch = await this.db.getChallengeById(id);
        if (!ch) return respond(`❓ No challenge with ID ${id}`);
        const text = this.formatChallenge(ch);
        await respond({ text });
      } catch (e) {
        console.error('preview error', e);
        await respond('❌ Failed to preview challenge.');
      }
    });

    // List scheduled messages
    this.app.command('/scheduled', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      try {
        const out = await this.app.client.chat.scheduledMessages.list({
          token: process.env.SLACK_BOT_TOKEN,
          channel: process.env.SLACK_CHALLENGES_CHANNEL
        });
        if (!out || !out.scheduled_messages || out.scheduled_messages.length === 0) {
          return respond('🗓️ No scheduled messages found for the channel.');
        }
        const lines = out.scheduled_messages.map(m =>
          `• smid: \`${m.id}\` – post_at: <t:${m.post_at}:F> – text: ${this.truncate(m.text, 60)}`
        );
        await respond(`🗓️ *Scheduled Messages:*\n${lines.join('\n')}`);
      } catch (e) {
        console.error('scheduled list error', e);
        await respond('❌ Failed to list scheduled messages.');
      }
    });

    // Unschedule
    this.app.command('/unschedule', async ({ command, ack, respond }) => {
      await ack();
      if (!(await this.requireAdminChannel(command, respond))) return;

      const smid = (command.text || '').trim();
      if (!smid) return respond('⚠️ Usage: `/unschedule <scheduled_message_id>`');
      try {
        await this.app.client.chat.deleteScheduledMessage({
          token: process.env.SLACK_BOT_TOKEN,
          channel: process.env.SLACK_CHALLENGES_CHANNEL,
          scheduled_message_id: smid
        });
        await respond(`🗑️ Unscheduled message \`${smid}\`.`);
      } catch (e) {
        console.error('unschedule error', e);
        await respond('❌ Failed to unschedule message (check id).');
      }
    });
  }

  // ---- Helpers ----
  async requireAdminChannel(command, respond) {
    const adminChannel = process.env.SLACK_ADMIN_CHANNEL;
    if (command.channel_id !== adminChannel) {
      await respond('⛔ This command must be used in the admin channel.');
      return false;
    }
    return true;
  }

  truncate(s, n) { return s && s.length > n ? s.slice(0, n-1) + '…' : s; }

  nextTuesdayNine() {
    const now = DateTime.now().setZone(TZ);
    const weekday = now.weekday; // 1..7 (Mon..Sun)
    const daysUntilTue = (2 - weekday + 7) % 7 || 7; // next Tuesday (not today)
    const dt = now.plus({ days: daysUntilTue }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    return Math.floor(dt.toSeconds());
  }

  nextNTuesdaysNine(n) {
    const arr = [];
    let ts = this.nextTuesdayNine();
    for (let i = 0; i < n; i++) {
      arr.push(ts);
      ts += 7 * 24 * 60 * 60; // week
    }
    return arr;
  }

  parseToEpoch(text) {
    // Expect "YYYY-MM-DD HH:mm" in EAT
    const dt = DateTime.fromFormat(text, 'yyyy-LL-dd HH:mm', { zone: TZ });
    if (!dt.isValid) return null;
    return Math.floor(dt.toSeconds());
  }

  formatChallenge(ch) {
    return `
🧩 *Weekly Coding Challenge* — ${String(ch.difficulty || '').toUpperCase()}

*${ch.title}*

${ch.description}

*Example:*
${ch.example}

*Function to complete:*
\`\`\`javascript
${ch.function_stub}
\`\`\`

${ch.url ? `*LeetCode Link:* <${ch.url}>` : ''}

Reply in this thread with your solution! 🚀
    `.trim();
  }

  async scheduleChallenge(ch, postAtEpoch) {
    const text = this.formatChallenge(ch);
    const res = await this.app.client.chat.scheduleMessage({
      token: process.env.SLACK_BOT_TOKEN,
      channel: process.env.SLACK_CHALLENGES_CHANNEL,
      text,
      post_at: postAtEpoch,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }]
    });
    const scheduled_message_id = res.scheduled_message_id || (res.message ? res.message.scheduled_message_id : null);
    await this.db.markScheduled(ch.id, postAtEpoch, scheduled_message_id || null);
    return { scheduled_message_id };
  }

  async start() {
    await this.app.start(process.env.PORT || 3000);
    console.log('⚡️ Slack bot is running (Render-ready). Endpoint: POST /slack/events');
  }
}

module.exports = SlackBot;